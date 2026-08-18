import os
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .catalog import get_book
from .companion import COMPANION, recommend, respond, respond_with_model
from .knowledge import (
    DuplicateDocumentError,
    KnowledgeError,
    delete_document,
    import_document,
    list_documents,
    search_chunks,
)
from .library import (
    bind_document,
    create_book,
    create_reading_note,
    delete_book,
    delete_reading_note,
    get_book_detail,
    list_books,
    list_reading_notes,
    search_reading_notes,
    update_book,
)
from .model_gateway import get_model_settings, test_model_connection, update_model_settings
from .relationship import (
    confirm_memory,
    delete_conversation,
    delete_memory,
    ensure_conversation,
    export_local_data,
    get_conversation,
    list_conversations,
    list_memories,
    recent_messages,
    record_chat,
    relevant_memories,
)
from .models import (
    ChatRequest,
    ChatResponse,
    CompanionMode,
    CompanionState,
    CompanionStatePatch,
    ConversationDetail,
    ConversationSummary,
    DemoSession,
    KnowledgeDocument,
    KnowledgeSearchRequest,
    KnowledgeSearchResponse,
    LibraryBook,
    LibraryBookCreate,
    LibraryBookDetail,
    LibraryBookPatch,
    LocalExport,
    Memory,
    MemoryPatch,
    MemoryStatus,
    ModelSettings,
    ModelSettingsPatch,
    ModelTestResponse,
    RecommendationRequest,
    RecommendationResponse,
    ReadingNote,
    ReadingNoteCreate,
    SharedThread,
    SearchPolicy,
)


app = FastAPI(
    title="BookMate API",
    version="0.1.0",
    description="Personal AI reading companion MVP skeleton",
)

origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


companion_state = CompanionState(
    mode=CompanionMode.BOOK_ROOM,
    active_book=get_book("the-stranger"),
    search_policy=SearchPolicy.ASK,
)


@app.get("/v1/about")
def root() -> dict[str, str]:
    return {"name": "BookMate API", "docs": "/docs"}


@app.get("/health")
def health() -> dict[str, str]:
    settings = get_model_settings()
    return {
        "status": "ok",
        "mode": "configured_model" if settings.base_url and settings.model else "demo",
    }


@app.get("/v1/demo/session", response_model=DemoSession)
def demo_session() -> DemoSession:
    return DemoSession(
        companion=COMPANION,
        current_book=get_book("the-stranger"),
        greeting=(
            "我们不急着概括《局外人》。读完以后，哪一点还留在你心里，"
            "甚至让你有些不同意别人通常的解释？"
        ),
        shared_thread=SharedThread(
            proposition="拒绝社会期待的表演，是否就等于冷漠？",
            open_question="诚实与对他人的责任发生冲突时，应该怎样判断？",
        ),
        preference_signals=["真实", "孤独", "道德选择"],
    )


@app.get("/v1/companion/state", response_model=CompanionState)
def get_companion_state() -> CompanionState:
    return companion_state


@app.patch("/v1/companion/state", response_model=CompanionState)
def patch_companion_state(patch: CompanionStatePatch) -> CompanionState:
    global companion_state
    mode = patch.mode or companion_state.mode
    search_policy = patch.search_policy or companion_state.search_policy
    active_book = companion_state.active_book

    if "active_book_id" in patch.model_fields_set:
        if patch.active_book_id is None:
            active_book = None
        else:
            try:
                active_book = get_book(patch.active_book_id)
            except KeyError as error:
                raise HTTPException(status_code=404, detail=str(error)) from error

    if mode == CompanionMode.GENERAL_COMPANION:
        active_book = None
    elif active_book is None:
        raise HTTPException(status_code=422, detail="book_room mode requires active_book_id")

    companion_state = CompanionState(mode=mode, active_book=active_book, search_policy=search_policy)
    return companion_state


@app.get("/v1/settings/model", response_model=ModelSettings)
def model_settings() -> ModelSettings:
    return get_model_settings()


@app.patch("/v1/settings/model", response_model=ModelSettings)
def patch_model_settings(patch: ModelSettingsPatch) -> ModelSettings:
    try:
        return update_model_settings(patch)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/v1/settings/model/test", response_model=ModelTestResponse)
async def model_connection_test() -> ModelTestResponse:
    return await test_model_connection()


@app.get("/v1/knowledge/documents", response_model=list[KnowledgeDocument])
def knowledge_documents() -> list[dict[str, object]]:
    return list_documents()


@app.post("/v1/knowledge/documents", response_model=KnowledgeDocument, status_code=status.HTTP_201_CREATED)
async def upload_knowledge_document(
    file: UploadFile = File(...), book_id: str | None = Form(default=None)
) -> dict[str, object]:
    try:
        if book_id:
            get_book_detail(book_id)
        return await import_document(file, book_id)
    except DuplicateDocumentError as error:
        raise HTTPException(
            status_code=409,
            detail={"message": str(error), "document_id": error.document_id},
        ) from error
    except KnowledgeError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.delete("/v1/knowledge/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_knowledge_document(document_id: str) -> Response:
    try:
        delete_document(document_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Document not found") from error
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/v1/library/books", response_model=list[LibraryBook])
def library_books(reading_status: str | None = None, query: str | None = None) -> list[LibraryBook]:
    return list_books(reading_status, query)


@app.post("/v1/library/books", response_model=LibraryBook, status_code=status.HTTP_201_CREATED)
def create_library_book(payload: LibraryBookCreate) -> LibraryBook:
    return create_book(payload)


@app.get("/v1/library/books/{book_id}", response_model=LibraryBookDetail)
def library_book(book_id: str) -> LibraryBookDetail:
    try:
        return get_book_detail(book_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Library book not found") from error


@app.patch("/v1/library/books/{book_id}", response_model=LibraryBook)
def patch_library_book(book_id: str, payload: LibraryBookPatch) -> LibraryBook:
    try:
        return update_book(book_id, payload)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Library book not found") from error


@app.delete("/v1/library/books/{book_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_library_book(book_id: str) -> Response:
    try:
        delete_book(book_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Library book not found") from error
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.patch("/v1/knowledge/documents/{document_id}/book", response_model=KnowledgeDocument)
def bind_knowledge_document(document_id: str, book_id: str | None = Form(default=None)) -> dict[str, object]:
    try:
        return bind_document(document_id, book_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Document or library book not found") from error


@app.post("/v1/library/books/{book_id}/notes", response_model=ReadingNote, status_code=status.HTTP_201_CREATED)
def add_reading_note(book_id: str, payload: ReadingNoteCreate) -> ReadingNote:
    try:
        return create_reading_note(book_id, payload)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Library book not found") from error


@app.delete("/v1/library/books/{book_id}/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_reading_note(book_id: str, note_id: str) -> Response:
    try:
        delete_reading_note(book_id, note_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Reading note not found") from error
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/v1/knowledge/search", response_model=KnowledgeSearchResponse)
def search_knowledge(request: KnowledgeSearchRequest) -> KnowledgeSearchResponse:
    return KnowledgeSearchResponse(
        items=search_chunks(request.query, request.document_id, request.limit)
    )


@app.get("/v1/conversations", response_model=list[ConversationSummary])
def conversations() -> list[ConversationSummary]:
    return list_conversations()


@app.get("/v1/conversations/{conversation_id}", response_model=ConversationDetail)
def conversation(conversation_id: str) -> ConversationDetail:
    try:
        return get_conversation(conversation_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Conversation not found") from error


@app.delete("/v1/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_conversation(conversation_id: str) -> Response:
    try:
        delete_conversation(conversation_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Conversation not found") from error
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/v1/memories", response_model=list[Memory])
def memories(status_filter: MemoryStatus | None = None) -> list[Memory]:
    return list_memories(status_filter)


@app.post("/v1/memories/{memory_id}/confirm", response_model=Memory)
def confirm_local_memory(memory_id: str, patch: MemoryPatch) -> Memory:
    try:
        return confirm_memory(memory_id, patch.content, patch.scope)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Memory not found") from error


@app.delete("/v1/memories/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_memory(memory_id: str) -> Response:
    try:
        delete_memory(memory_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Memory not found") from error
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/v1/export", response_model=LocalExport)
def export_data() -> dict[str, object]:
    books = list_books()
    return export_local_data(
        list_documents(),
        books,
        [note for book in books for note in list_reading_notes(book.id)],
    )


@app.post("/v1/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    if (
        request.mode == CompanionMode.BOOK_ROOM
        and not request.book_id
        and not (request.knowledge_document_id and request.book_title)
        and not (request.library_book_id and request.book_title)
    ):
        raise HTTPException(status_code=422, detail="book_room mode requires a catalog book or local document")
    try:
        current_conversation = ensure_conversation(request)
        history = recent_messages(current_conversation.id)
        memories_for_context = relevant_memories(current_conversation.id, request)
        settings = get_model_settings()
        if settings.base_url and settings.model:
            passages = (
                search_chunks(request.message, request.knowledge_document_id, limit=4)
                if request.knowledge_document_id
                else []
            )
            notes = (
                search_reading_notes(request.library_book_id, request.message, limit=4)
                if request.library_book_id
                else []
            )
            response = await respond_with_model(request, passages, notes, history, memories_for_context)
        else:
            response = respond(request)
        return record_chat(current_conversation.id, request, response)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Model request failed: {str(error)[:500]}") from error


@app.post("/v1/recommendations", response_model=RecommendationResponse)
def recommendations(request: RecommendationRequest) -> RecommendationResponse:
    return recommend(request)


web_directory = Path(os.getenv("BOOKMATE_WEB_DIR", ""))
if web_directory.is_dir():
    app.mount("/", StaticFiles(directory=web_directory, html=True), name="web")
