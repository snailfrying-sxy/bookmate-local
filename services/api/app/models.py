from enum import StrEnum
from datetime import datetime

from pydantic import BaseModel, Field


class ConversationDirection(StrEnum):
    FOLLOW = "follow"
    CHALLENGE = "challenge"
    LIFE = "life"


class CompanionMode(StrEnum):
    GENERAL_COMPANION = "general_companion"
    BOOK_ROOM = "book_room"


class SearchPolicy(StrEnum):
    OFF = "off"
    ASK = "ask"
    AUTO = "auto"


class SearchAction(StrEnum):
    NOT_NEEDED = "not_needed"
    DISABLED = "disabled"
    PERMISSION_REQUIRED = "permission_required"
    WOULD_SEARCH = "would_search"


class ModelProtocol(StrEnum):
    CHAT_COMPLETIONS = "chat_completions"
    RESPONSES = "responses"


class MemoryScope(StrEnum):
    GLOBAL = "global"
    BOOK = "book"
    SESSION = "session"


class MemoryStatus(StrEnum):
    PENDING = "pending"
    CONFIRMED = "confirmed"


class ReadingStatus(StrEnum):
    WANT_TO_READ = "want_to_read"
    READING = "reading"
    FINISHED = "finished"
    PAUSED = "paused"


class SpoilerPolicy(StrEnum):
    AVOID = "avoid"
    UP_TO_PROGRESS = "up_to_progress"
    ALLOW = "allow"


class CompanionStance(StrEnum):
    EXPLORE = "explore"
    CHALLENGE = "challenge"
    ORGANIZE = "organize"
    BOOK_CLUB = "book_club"


class ReadingNoteKind(StrEnum):
    QUOTE = "quote"
    REFLECTION = "reflection"
    QUESTION = "question"


class FlowMove(StrEnum):
    LISTEN = "listen"
    MIRROR = "mirror"
    TENSION = "tension"
    CONNECT = "connect"


class RecommendationLane(StrEnum):
    CONTINUE = "continue"
    COUNTERPOINT = "counterpoint"
    CROSSOVER = "crossover"


class CompanionProfile(BaseModel):
    name: str
    role: str
    identity_statement: str
    temperament: list[str]
    boundaries: list[str]


class Book(BaseModel):
    id: str
    title: str
    author: str
    year: int | None = None
    description: str
    tags: list[str]
    lane_hint: RecommendationLane
    caution: str
    entry_question: str


class SharedThread(BaseModel):
    proposition: str
    open_question: str


class DemoSession(BaseModel):
    companion: CompanionProfile
    current_book: Book
    greeting: str
    shared_thread: SharedThread
    preference_signals: list[str]


class CompanionState(BaseModel):
    mode: CompanionMode
    active_book: Book | None
    search_policy: SearchPolicy


class CompanionStatePatch(BaseModel):
    mode: CompanionMode | None = None
    active_book_id: str | None = None
    search_policy: SearchPolicy | None = None


class ModelSettings(BaseModel):
    protocol: ModelProtocol = ModelProtocol.CHAT_COMPLETIONS
    base_url: str = ""
    model: str = ""
    api_key_configured: bool = False
    api_key: str | None = Field(default=None, exclude=True)
    timeout_seconds: int = 60
    source: str = "default"


class ModelSettingsPatch(BaseModel):
    protocol: ModelProtocol | None = None
    base_url: str | None = Field(default=None, max_length=500)
    model: str | None = Field(default=None, max_length=200)
    api_key: str | None = Field(default=None, max_length=1000)
    clear_api_key: bool = False
    timeout_seconds: int | None = Field(default=None, ge=5, le=300)


class ModelTestResponse(BaseModel):
    ok: bool
    message: str
    model: str | None
    latency_ms: int
    preview: str | None


class KnowledgeDocument(BaseModel):
    id: str
    book_id: str | None
    name: str
    media_type: str | None
    extension: str
    size_bytes: int
    status: str
    chunk_count: int
    error: str | None
    created_at: datetime


class LibraryBookCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    author: str | None = Field(default=None, max_length=200)
    language: str | None = Field(default=None, max_length=50)
    description: str | None = Field(default=None, max_length=2000)
    reading_status: ReadingStatus = ReadingStatus.WANT_TO_READ
    isbn: str | None = Field(default=None, max_length=32)
    reading_progress: str | None = Field(default=None, max_length=200)
    spoiler_policy: SpoilerPolicy = SpoilerPolicy.AVOID
    companion_stance: CompanionStance = CompanionStance.EXPLORE
    room_intent: str | None = Field(default=None, max_length=1000)
    tags: list[str] = Field(default_factory=list, max_length=20)


class LibraryBookPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    author: str | None = Field(default=None, max_length=200)
    language: str | None = Field(default=None, max_length=50)
    description: str | None = Field(default=None, max_length=2000)
    reading_status: ReadingStatus | None = None
    isbn: str | None = Field(default=None, max_length=32)
    reading_progress: str | None = Field(default=None, max_length=200)
    spoiler_policy: SpoilerPolicy | None = None
    companion_stance: CompanionStance | None = None
    room_intent: str | None = Field(default=None, max_length=1000)
    tags: list[str] | None = Field(default=None, max_length=20)


class LibraryBook(BaseModel):
    id: str
    title: str
    author: str | None
    language: str | None
    description: str | None
    reading_status: ReadingStatus
    isbn: str | None
    reading_progress: str | None
    spoiler_policy: SpoilerPolicy
    companion_stance: CompanionStance
    room_intent: str | None
    tags: list[str]
    document_count: int
    note_count: int
    created_at: datetime
    updated_at: datetime


class LibraryBookDetail(LibraryBook):
    documents: list[KnowledgeDocument]
    notes: list["ReadingNote"]


class ReadingNoteCreate(BaseModel):
    kind: ReadingNoteKind
    content: str = Field(min_length=1, max_length=8000)
    quote: str | None = Field(default=None, max_length=8000)
    locator: str | None = Field(default=None, max_length=300)


class ReadingNote(BaseModel):
    id: str
    book_id: str
    kind: ReadingNoteKind
    content: str
    quote: str | None
    locator: str | None
    created_at: datetime


class KnowledgeSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    document_id: str | None = None
    limit: int = Field(default=5, ge=1, le=20)


class KnowledgeChunk(BaseModel):
    chunk_id: int
    document_id: str
    document_name: str
    ordinal: int
    locator: str | None
    text: str
    score: float


class KnowledgeSearchResponse(BaseModel):
    items: list[KnowledgeChunk]


class Citation(BaseModel):
    source_type: str
    label: str
    locator: str | None = None


class SearchDecision(BaseModel):
    needed: bool
    action: SearchAction
    reason: str
    suggested_queries: list[str] = Field(default_factory=list)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    mode: CompanionMode = CompanionMode.BOOK_ROOM
    book_id: str | None = "the-stranger"
    book_title: str | None = Field(default=None, max_length=300)
    direction: ConversationDirection = ConversationDirection.FOLLOW
    search_policy: SearchPolicy = SearchPolicy.ASK
    search_permission_granted: bool = False
    knowledge_document_id: str | None = None
    library_book_id: str | None = None
    conversation_id: str | None = None


class ChatResponse(BaseModel):
    companion_name: str
    reply: str
    follow_up: str
    flow_move: FlowMove
    memory_candidate: str | None
    citations: list[Citation]
    mode: CompanionMode
    active_book: Book | None
    search_decision: SearchDecision
    conversation_id: str | None = None
    memory_candidate_id: str | None = None
    model_used: str | None = None
    demo_mode: bool = True


class ConversationSummary(BaseModel):
    id: str
    title: str
    mode: CompanionMode
    book_key: str | None
    book_title: str | None
    document_id: str | None
    message_count: int
    created_at: datetime
    updated_at: datetime


class ConversationMessage(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    created_at: datetime


class ConversationDetail(ConversationSummary):
    messages: list[ConversationMessage]


class Memory(BaseModel):
    id: str
    conversation_id: str
    scope: MemoryScope
    book_key: str | None
    book_title: str | None
    content: str
    source_message_id: str | None
    status: MemoryStatus
    created_at: datetime
    confirmed_at: datetime | None


class MemoryPatch(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=500)
    scope: MemoryScope | None = None


class LocalExport(BaseModel):
    schema_version: int
    exported_at: datetime
    conversations: list[ConversationDetail]
    memories: list[Memory]
    documents: list[KnowledgeDocument]
    library_books: list[LibraryBook]
    reading_notes: list[ReadingNote]


class RecommendationRequest(BaseModel):
    signals: list[str] = Field(default_factory=list, max_length=20)
    current_book_id: str | None = None


class Recommendation(BaseModel):
    book: Book
    lane: RecommendationLane
    why: str
    matched_signals: list[str]
    score: float


class RecommendationResponse(BaseModel):
    items: list[Recommendation]
    explanation: str
    demo_mode: bool = True
