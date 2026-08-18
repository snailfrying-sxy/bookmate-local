"use client";

import { DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Direction = "follow" | "challenge" | "life";
type Lane = "continue" | "counterpoint" | "crossover";
type CompanionMode = "general_companion" | "book_room";
type SearchPolicy = "off" | "ask" | "auto";
type ModelProtocol = "chat_completions" | "responses";
type MemoryScope = "global" | "book" | "session";
type ReadingStatus = "want_to_read" | "reading" | "finished" | "paused";
type SpoilerPolicy = "avoid" | "up_to_progress" | "allow";
type CompanionStance = "explore" | "challenge" | "organize" | "book_club";
type ReadingNoteKind = "quote" | "reflection" | "question";
type MessageFeedback = "understood" | "insightful" | "off_base";
type ImportTab = "files" | "books" | "notes";
type DocumentFilter = "all" | "unfiled" | "assigned";

type Message = {
  id: string;
  role: "companion" | "reader";
  text: string;
  move?: string;
  systemNote?: string;
  memoryId?: string;
  memoryText?: string;
  errorAction?: "retry" | "settings";
  retryText?: string;
};

class ChatResponseError extends Error {
  action: "retry" | "settings";

  constructor(message: string, action: "retry" | "settings") {
    super(message);
    this.name = "ChatResponseError";
    this.action = action;
  }
}

type Recommendation = {
  lane: Lane;
  why: string;
  book: {
    id: string;
    title: string;
    author: string;
    caution: string;
    entry_question: string;
  };
};

type ModelSettings = {
  protocol: ModelProtocol;
  base_url: string;
  model: string;
  api_key_configured: boolean;
  timeout_seconds: number;
  source: string;
};

type ModelProfile = {
  id: string;
  name: string;
  protocol: ModelProtocol;
  base_url: string;
  model: string;
  api_key_configured: boolean;
  timeout_seconds: number;
  source: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

type ReaderProfile = {
  display_name: string;
};

type KnowledgeDocument = {
  id: string;
  book_id: string | null;
  name: string;
  extension: string;
  size_bytes: number;
  status: string;
  chunk_count: number;
  error?: string | null;
};

type LibraryBook = {
  id: string;
  title: string;
  author: string | null;
  reading_status: ReadingStatus;
  isbn: string | null;
  reading_progress: string | null;
  spoiler_policy: SpoilerPolicy;
  companion_stance: CompanionStance;
  room_intent: string | null;
  tags: string[];
  document_count: number;
  note_count: number;
};

type ReadingNote = {
  id: string;
  book_id: string;
  kind: ReadingNoteKind;
  content: string;
  quote: string | null;
  locator: string | null;
  created_at: string;
};

type LibraryBookDetail = LibraryBook & { notes: ReadingNote[] };

type ConversationSummary = {
  id: string;
  title: string;
  mode: CompanionMode;
  book_key: string | null;
  book_title: string | null;
  document_id: string | null;
  message_count: number;
  updated_at: string;
};

type StoredMessage = {
  id: string;
  role: "reader" | "companion";
  content: string;
};

type LocalMemory = {
  id: string;
  conversation_id: string;
  scope: MemoryScope;
  book_title: string | null;
  content: string;
  status: "pending" | "confirmed";
  created_at: string;
};

// The packaged app is served by FastAPI, so use the current origin and avoid
// treating localhost and 127.0.0.1 as different browser origins.
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL
  ?? (typeof window !== "undefined" && window.location.port === "8000" ? "" : "http://localhost:8000")
).replace(/\/$/, "");

const directionOptions: Array<{ id: Direction; label: string; note: string }> = [
  { id: "follow", label: "顺着聊", note: "先把这个想法说清" },
  { id: "challenge", label: "较真一点", note: "给我一个真正的反方" },
  { id: "life", label: "联系生活", note: "看看它为何触动了我" },
];

const laneLabels: Record<Lane, string> = {
  continue: "延续",
  counterpoint: "反面",
  crossover: "跨越",
};

function modelNameForDisplay(model: string) {
  const value = model.trim();
  if (!value) return "未命名模型";
  if (value.toLowerCase() === "deepseek-chat") return "DeepSeek Chat";

  const qwenMatch = value.match(/^qwen([\d.]+):(\d+)b(?:-(.+))?$/i);
  if (qwenMatch) {
    return `Qwen ${qwenMatch[1]} ${qwenMatch[2]}B${qwenMatch[3] ? ` ${qwenMatch[3].replace(/-/g, " ")}` : ""}`;
  }

  return value;
}

function profileNameForDisplay(profile: ModelProfile) {
  const name = profile.name.trim();
  // Old profiles often used an IP address as a name; keep infrastructure out of chat UI.
  if (!name || /https?:\/\/|(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?/.test(name)) {
    return modelNameForDisplay(profile.model);
  }
  return name;
}

function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a href={href} rel="noreferrer" target="_blank">{children}</a>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

async function chatErrorFromResponse(response: Response): Promise<ChatResponseError> {
  let detail = "";
  try {
    const body = await response.text();
    if (body) {
      const parsed = JSON.parse(body) as { detail?: unknown };
      detail = typeof parsed.detail === "string" ? parsed.detail.toLowerCase() : "";
    }
  } catch {
    // The response status is enough to provide a useful, non-technical next step.
  }

  const hasDetail = (terms: string[]) => terms.some((term) => detail.includes(term));
  if (response.status === 401 || response.status === 403 || hasDetail([
    "authentication", "unauthorized", "forbidden", "api key", "invalid key",
  ])) {
    return new ChatResponseError("书友模型没有通过验证。请检查模型设置后再试。", "settings");
  }
  if (response.status === 408 || response.status === 504 || hasDetail(["timeout", "timed out"])) {
    return new ChatResponseError("书友模型这次等得有些久。请稍后重新发送。", "retry");
  }
  if (hasDetail(["connecterror", "connection", "network is unreachable", "connection refused"])) {
    return new ChatResponseError("书友模型暂时无法连接。请检查模型设置后再试。", "settings");
  }
  if (response.status === 422) {
    return new ChatResponseError("这句话暂时无法发送。请确认当前书房后再试。", "retry");
  }
  if (response.status >= 500) {
    return new ChatResponseError("这次对话没有完成。请重新发送；若持续发生，请检查模型设置。", "retry");
  }
  return new ChatResponseError("这次没有得到完整回应。请重新发送。", "retry");
}

function fitComposer(textarea: HTMLTextAreaElement) {
  const maximumHeight = 132;
  textarea.style.height = "auto";
  const height = Math.min(textarea.scrollHeight, maximumHeight);
  textarea.style.height = `${height}px`;
  textarea.style.overflowY = textarea.scrollHeight > maximumHeight ? "auto" : "hidden";
}

function emptyModelSettings(): ModelSettings {
  return {
    protocol: "chat_completions",
    base_url: "",
    model: "",
    api_key_configured: false,
    timeout_seconds: 60,
    source: "default",
  };
}

const welcomeByMode: Record<CompanionMode, string> = {
  general_companion: "不必先选一本书。最近有没有一个念头，总在心里回来？你可以从它开始，我会先听你把话说完。",
  book_room: "先不急着谈《局外人》讲了什么。合上书以后，哪一个念头还没有离开你？",
};

const searchPolicyLabels: Record<SearchPolicy, string> = {
  off: "不联网",
  ask: "需要时先问我",
  auto: "动态问题自动查",
};

const readingStatusLabels: Record<ReadingStatus, string> = {
  want_to_read: "想读",
  reading: "在读",
  finished: "已读",
  paused: "暂搁",
};

const spoilerPolicyLabels: Record<SpoilerPolicy, string> = {
  avoid: "避免剧透",
  up_to_progress: "只到我的进度",
  allow: "允许完整讨论",
};

const companionStanceLabels: Record<CompanionStance, string> = {
  explore: "陪我慢慢想",
  challenge: "和我认真较真",
  organize: "帮我整理线索",
  book_club: "准备读书会",
};

const readingNoteKindLabels: Record<ReadingNoteKind, string> = {
  quote: "摘录",
  reflection: "读后感",
  question: "想继续问",
};

const fallbackRecommendations: Recommendation[] = [
  {
    lane: "continue",
    why: "延续你对真实与孤独的追问，但把答案交还给一个人的亲身经历。",
    book: {
      id: "siddhartha",
      title: "悉达多",
      author: "赫尔曼·黑塞",
      caution: "寓言感较强，不是严密的哲学论证。",
      entry_question: "有些理解是否只能活过，而无法被教会？",
    },
  },
  {
    lane: "counterpoint",
    why: "把“忠于真实”推到令人不舒服的位置，挑战它是否也可能变成自我困住。",
    book: {
      id: "notes-from-underground",
      title: "地下室手记",
      author: "陀思妥耶夫斯基",
      caution: "叙述者尖刻而反复，阅读体验故意令人不舒服。",
      entry_question: "拒绝所有解释，会让人更自由吗？",
    },
  },
  {
    lane: "crossover",
    why: "从文学跨到心理与伦理，继续讨论选择、责任和意义。",
    book: {
      id: "mans-search-for-meaning",
      title: "活出生命的意义",
      author: "维克多·弗兰克尔",
      caution: "涉及集中营与苦难，不应把它简化成励志读物。",
      entry_question: "意义是被发现的，还是在回应处境时创造的？",
    },
  },
];

// This is an intentionally different set of reading doors for an offline-first
// preview. It avoids implying that a fresh external search has taken place.
const alternativeRecommendations: Recommendation[] = [
  {
    lane: "continue",
    why: "从思想辩论退半步，去看人在共同生活里如何既想靠近，又想保留自己的边界。",
    book: {
      id: "the-summer-book",
      title: "夏日之书",
      author: "托芙·扬松",
      caution: "篇幅短而留白很多，适合慢读，不适合期待强情节推进。",
      entry_question: "亲密关系里，沉默什么时候是陪伴，什么时候又成了回避？",
    },
  },
  {
    lane: "counterpoint",
    why: "把自由从个人选择推到共同制度里，看看理想如何在具体关系中变形。",
    book: {
      id: "the-dispossessed",
      title: "一无所有",
      author: "厄休拉·勒古恩",
      caution: "它借科幻讨论政治与组织，阅读时需要接受较多制度设定。",
      entry_question: "如果人人都追求自由，谁来承担彼此无法回避的责任？",
    },
  },
  {
    lane: "crossover",
    why: "换一条非虚构的路，从人与土地、知识和互惠的关系里重新看“意义”。",
    book: {
      id: "braiding-sweetgrass",
      title: "编织甜草",
      author: "罗宾·沃尔·基默尔",
      caution: "它来自特定的原住民知识传统，不宜把其中经验抽成通用的励志箴言。",
      entry_question: "当我们说“拥有”一件事物时，是否也同时改变了与它相处的方式？",
    },
  },
];

const feedbackLabels: Record<MessageFeedback, string> = {
  understood: "被理解",
  insightful: "有启发",
  off_base: "理解偏了",
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "companion",
      text: "先不急着谈《局外人》讲了什么。合上书以后，哪一个念头还没有离开你？",
      move: "邀请",
    },
  ]);
  const [direction, setDirection] = useState<Direction>("follow");
  const [mode, setMode] = useState<CompanionMode>("book_room");
  const [searchPolicy, setSearchPolicy] = useState<SearchPolicy>("ask");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>(fallbackRecommendations);
  const [showAlternativeRecommendations, setShowAlternativeRecommendations] = useState(false);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [feedbackByMessage, setFeedbackByMessage] = useState<Record<string, MessageFeedback>>({});
  const [composerNotice, setComposerNotice] = useState("");
  const [showLocalSetup, setShowLocalSetup] = useState(false);
  const [showImportCenter, setShowImportCenter] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [libraryBooks, setLibraryBooks] = useState<LibraryBook[]>([]);
  const [readingNotes, setReadingNotes] = useState<ReadingNote[]>([]);
  const [selectedLibraryBookId, setSelectedLibraryBookId] = useState<string | null>(null);
  const [newBookTitle, setNewBookTitle] = useState("");
  const [newBookAuthor, setNewBookAuthor] = useState("");
  const [newBookStatus, setNewBookStatus] = useState<ReadingStatus>("want_to_read");
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [importTab, setImportTab] = useState<ImportTab>("files");
  const [importTargetBookId, setImportTargetBookId] = useState<string | null>(null);
  const [documentFilter, setDocumentFilter] = useState<DocumentFilter>("all");
  const [modelSettings, setModelSettings] = useState<ModelSettings>(emptyModelSettings);
  const [modelDraft, setModelDraft] = useState<ModelSettings>(emptyModelSettings);
  const [modelProfiles, setModelProfiles] = useState<ModelProfile[]>([]);
  const [readerProfile, setReaderProfile] = useState<ReaderProfile>({ display_name: "" });
  const [readerDisplayName, setReaderDisplayName] = useState("");
  const [selectedModelProfileId, setSelectedModelProfileId] = useState<string | null>(null);
  const [modelProfileName, setModelProfileName] = useState("");
  const [editingModelProfileId, setEditingModelProfileId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [setupStatus, setSetupStatus] = useState("正在准备模型列表……");
  const [setupPending, setSetupPending] = useState(false);
  const [showRelationship, setShowRelationship] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [memories, setMemories] = useState<LocalMemory[]>([]);
  const [relationshipStatus, setRelationshipStatus] = useState("记忆只会在你确认后用于未来对话。");
  const [activeBookId, setActiveBookId] = useState<string | null>("the-stranger");
  const [activeBookTitle, setActiveBookTitle] = useState("局外人");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const conversationStreamRef = useRef<HTMLDivElement>(null);

  const activeDirection = useMemo(
    () => directionOptions.find((option) => option.id === direction)!,
    [direction],
  );
  const activeDocument = useMemo(
    () => documents.find((document) => document.id === selectedDocumentId) ?? null,
    [documents, selectedDocumentId],
  );
  const selectedLibraryBook = useMemo(
    () => libraryBooks.find((book) => book.id === selectedLibraryBookId) ?? null,
    [libraryBooks, selectedLibraryBookId],
  );
  const displayedRecommendations = showAlternativeRecommendations
    ? alternativeRecommendations
    : recommendations;
  const visibleImportDocuments = useMemo(() => documents.filter((document) => (
    documentFilter === "all"
      || (documentFilter === "unfiled" ? !document.book_id : Boolean(document.book_id))
  )), [documents, documentFilter]);

  function focusComposer() {
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  useEffect(() => {
    const stream = conversationStreamRef.current;
    if (stream) stream.scrollTo({ top: stream.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  useEffect(() => {
    if (composerRef.current) fitComposer(composerRef.current);
  }, [input]);

  function startRecommendationConversation(item: Recommendation) {
    setShowRecommendations(false);
    switchMode("general_companion");
    setInput(item.book.entry_question);
    setComposerNotice(`已带入《${item.book.title}》的切入问题；你可以改写后再交给泊舟。`);
    focusComposer();
  }

  function changeRecommendationDirection() {
    setShowAlternativeRecommendations((current) => !current);
    setComposerNotice(showAlternativeRecommendations
      ? "已回到原来的三种阅读邀请。"
      : "已换一组不同的阅读入口；这不是外部搜索或商业排序。",
    );
  }

  function recordFeedback(messageId: string, feedback: MessageFeedback) {
    setFeedbackByMessage((current) => ({ ...current, [messageId]: feedback }));
    setComposerNotice(`已记下“${feedbackLabels[feedback]}”。这只用于调整本次对话，不会写入长期记忆。`);
  }

  function switchMode(nextMode: CompanionMode, documentName?: string) {
    const localTitle = documentName ?? activeDocument?.name;
    setMode(nextMode);
    setConversationId(null);
    if (nextMode === "book_room") {
      if (documentName) {
        setActiveBookId(null);
        setActiveBookTitle(documentName);
      } else if (!localTitle) {
        setActiveBookId("the-stranger");
        setActiveBookTitle("局外人");
      }
    }
    setMessages([
      {
        id: `welcome-${nextMode}`,
        role: "companion",
        text: nextMode === "book_room" && localTitle
          ? `关于《${localTitle}》，不必从概括开始。把那句还留在心里的话告诉我；我们从那里继续。`
          : welcomeByMode[nextMode],
        move: "邀请",
      },
    ]);
  }

  useEffect(() => {
    let active = true;
    async function loadDemo() {
      let receivedResponse = false;
      try {
        const [sessionResponse, recommendationResponse] = await Promise.all([
          fetch(`${API_BASE}/v1/demo/session`),
          fetch(`${API_BASE}/v1/recommendations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              signals: ["真实", "孤独", "道德选择"],
              current_book_id: "the-stranger",
            }),
          }),
        ]);
        receivedResponse = true;
        if (!sessionResponse.ok || !recommendationResponse.ok) {
          throw new Error("Initial data request failed");
        }
        const session = await sessionResponse.json();
        const recommendationData = await recommendationResponse.json();
        if (!active) return;
        setMessages([
          { id: "welcome", role: "companion", text: session.greeting, move: "邀请" },
        ]);
        setRecommendations(recommendationData.items);
        setApiOnline(true);
      } catch {
        // An HTTP response means BookMate is reachable even if optional home data failed.
        if (active) setApiOnline(receivedResponse);
      }
    }
    loadDemo();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    refreshLibraryData();
  }, []);

  async function refreshRelationshipData() {
    try {
      const [conversationResponse, memoryResponse] = await Promise.all([
        fetch(`${API_BASE}/v1/conversations`),
        fetch(`${API_BASE}/v1/memories`),
      ]);
      if (!conversationResponse.ok || !memoryResponse.ok) return;
      setConversations(await conversationResponse.json());
      setMemories(await memoryResponse.json());
    } catch {
      // A local preview without the API remains usable.
    }
  }

  useEffect(() => {
    refreshRelationshipData();
  }, []);

  async function refreshLibraryData() {
    try {
      const [booksResponse, documentsResponse] = await Promise.all([
        fetch(`${API_BASE}/v1/library/books`),
        fetch(`${API_BASE}/v1/knowledge/documents`),
      ]);
      if (!booksResponse.ok || !documentsResponse.ok) return;
      setLibraryBooks(await booksResponse.json());
      setDocuments(await documentsResponse.json());
    } catch {
      // The first-run interface remains usable without a running local API.
    }
  }

  async function loadBookRoomDetails(bookId: string) {
    try {
      const response = await fetch(`${API_BASE}/v1/library/books/${bookId}`);
      if (!response.ok) return;
      const detail: LibraryBookDetail = await response.json();
      setReadingNotes(detail.notes);
      setLibraryBooks((current) => current.map((book) => book.id === detail.id ? detail : book));
    } catch {
      // Keep the selected book usable even if its optional notes cannot be refreshed.
    }
  }

  async function createLibraryBook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newBookTitle.trim();
    if (!title) return;
    setSetupPending(true);
    setSetupStatus("正在把这本书放进你的本地书架……");
    try {
      const response = await fetch(`${API_BASE}/v1/library/books`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          author: newBookAuthor.trim() || null,
          reading_status: newBookStatus,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const book: LibraryBook = await response.json();
      setLibraryBooks((current) => [book, ...current]);
      setSelectedLibraryBookId(book.id);
      setImportTargetBookId(book.id);
      setSelectedDocumentId(null);
      setReadingNotes([]);
      setActiveBookId(null);
      setActiveBookTitle(book.title);
      setNewBookTitle("");
      setNewBookAuthor("");
      switchMode("book_room", book.title);
      setSetupStatus(`《${book.title}》已加入本地书架。现在可以上传版本、笔记或直接开始交流。`);
    } catch (error) {
      setSetupStatus(`添加书籍失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setSetupPending(false);
    }
  }

  function selectLibraryBook(book: LibraryBook) {
    setSelectedLibraryBookId(book.id);
    setActiveBookId(null);
    setActiveBookTitle(book.title);
    const firstDocument = documents.find((document) => document.book_id === book.id) ?? null;
    setSelectedDocumentId(firstDocument?.id ?? null);
    loadBookRoomDetails(book.id);
    switchMode("book_room", book.title);
  }

  async function saveBookRoomSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedLibraryBook) return;
    const form = new FormData(event.currentTarget);
    setSetupPending(true);
    try {
      const response = await fetch(`${API_BASE}/v1/library/books/${selectedLibraryBook.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isbn: String(form.get("isbn") ?? "").trim() || null,
          reading_progress: String(form.get("reading_progress") ?? "").trim() || null,
          spoiler_policy: form.get("spoiler_policy"),
          companion_stance: form.get("companion_stance"),
          room_intent: String(form.get("room_intent") ?? "").trim() || null,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const updated: LibraryBook = await response.json();
      setLibraryBooks((current) => current.map((book) => book.id === updated.id ? updated : book));
      setSetupStatus(`《${updated.title}》的书房规则已保存。`);
    } catch (error) {
      setSetupStatus(`保存书房规则失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setSetupPending(false);
    }
  }

  async function captureReadingNote(event: FormEvent<HTMLFormElement>, targetBookId = selectedLibraryBookId) {
    event.preventDefault();
    if (!targetBookId) {
      setSetupStatus("先选择一本书，再把这条阅读痕迹留给它。");
      return;
    }
    const targetBook = libraryBooks.find((book) => book.id === targetBookId) ?? null;
    const form = new FormData(event.currentTarget);
    const content = String(form.get("content") ?? "").trim();
    if (!content) return;
    setSetupPending(true);
    try {
      const response = await fetch(`${API_BASE}/v1/library/books/${targetBookId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: form.get("kind"),
          quote: String(form.get("quote") ?? "").trim() || null,
          content,
          locator: String(form.get("locator") ?? "").trim() || null,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const note: ReadingNote = await response.json();
      if (selectedLibraryBookId === targetBookId) setReadingNotes((current) => [note, ...current]);
      setLibraryBooks((current) => current.map((book) => (
        book.id === targetBookId ? { ...book, note_count: book.note_count + 1 } : book
      )));
      event.currentTarget.reset();
      setSetupStatus(`这条阅读痕迹已保存到《${targetBook?.title ?? "所选书目"}》，并会在书房中作为你的线索。`);
    } catch (error) {
      setSetupStatus(`保存阅读痕迹失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setSetupPending(false);
    }
  }

  async function removeReadingNote(note: ReadingNote) {
    if (!selectedLibraryBook) return;
    if (!window.confirm("删除这条摘录或读后感？它不会再作为书房线索。")) return;
    try {
      const response = await fetch(
        `${API_BASE}/v1/library/books/${selectedLibraryBook.id}/notes/${note.id}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("Note unavailable");
      setReadingNotes((current) => current.filter((item) => item.id !== note.id));
      setLibraryBooks((current) => current.map((book) => (
        book.id === selectedLibraryBook.id ? { ...book, note_count: Math.max(0, book.note_count - 1) } : book
      )));
      setSetupStatus("已删除这条本地阅读痕迹。 ");
    } catch {
      setSetupStatus("删除阅读痕迹失败，请稍后重试。 ");
    }
  }

  async function updateReadingStatus(book: LibraryBook, readingStatus: ReadingStatus) {
    try {
      const response = await fetch(`${API_BASE}/v1/library/books/${book.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reading_status: readingStatus }),
      });
      if (!response.ok) throw new Error("Book unavailable");
      const updated: LibraryBook = await response.json();
      setLibraryBooks((current) => current.map((item) => item.id === book.id ? updated : item));
    } catch {
      setSetupStatus("更新阅读状态失败，请稍后重试。");
    }
  }

  async function removeLibraryBook(book: LibraryBook) {
    if (!window.confirm(`从书架移除《${book.title}》？关联文件会保留在“未归档资料”中。`)) return;
    try {
      const response = await fetch(`${API_BASE}/v1/library/books/${book.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Book unavailable");
      if (selectedLibraryBookId === book.id) {
        setSelectedLibraryBookId(null);
        setSelectedDocumentId(null);
        setReadingNotes([]);
        setActiveBookId("the-stranger");
        setActiveBookTitle("局外人");
      }
      await refreshLibraryData();
      setSetupStatus(`《${book.title}》已从书架移除；原始文件没有被删除。`);
    } catch {
      setSetupStatus("移除书籍失败，请稍后重试。");
    }
  }

  async function continueConversation(summary: ConversationSummary) {
    try {
      const response = await fetch(`${API_BASE}/v1/conversations/${summary.id}`);
      if (!response.ok) throw new Error("Conversation unavailable");
      const detail: { messages: StoredMessage[] } = await response.json();
      setConversationId(summary.id);
      setMode(summary.mode);
      setActiveBookTitle(summary.book_title ?? "局外人");
      const libraryBookId = summary.book_key?.startsWith("library:")
        ? summary.book_key.slice("library:".length)
        : null;
      if (libraryBookId) {
        setSelectedLibraryBookId(libraryBookId);
        loadBookRoomDetails(libraryBookId);
        setSelectedDocumentId(summary.document_id && documents.some((document) => document.id === summary.document_id)
          ? summary.document_id
          : null);
        setActiveBookId(null);
      } else if (summary.document_id && documents.some((document) => document.id === summary.document_id)) {
        setSelectedDocumentId(summary.document_id);
        setSelectedLibraryBookId(null);
        setActiveBookId(null);
      } else {
        const catalogId = summary.book_key?.startsWith("catalog:")
          ? summary.book_key.slice("catalog:".length)
          : "the-stranger";
        setSelectedDocumentId(null);
        setSelectedLibraryBookId(null);
        setActiveBookId(catalogId);
      }
      setMessages(detail.messages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.content,
      })));
      setShowRelationship(false);
      setRelationshipStatus("已恢复本地对话。接下来会延续这段会话与已确认记忆。");
    } catch {
      setRelationshipStatus("恢复对话失败；原始数据仍保留在本机。请稍后重试。");
    }
  }

  async function confirmMemory(memory: LocalMemory) {
    try {
      const response = await fetch(`${API_BASE}/v1/memories/${memory.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: memory.scope }),
      });
      if (!response.ok) throw new Error("Memory unavailable");
      await refreshRelationshipData();
      setMessages((current) => current.map((message) => (
        message.memoryId === memory.id
          ? { ...message, memoryId: undefined, systemNote: `${message.systemNote ?? ""} 已确认写入本地记忆。`.trim() }
          : message
      )));
      setRelationshipStatus("已确认。这条记忆会按其作用范围参与后续对话。你可以随时删除它。");
    } catch {
      setRelationshipStatus("保存记忆失败，请稍后重试。");
    }
  }

  async function removeMemory(memory: LocalMemory) {
    if (!window.confirm("删除这条本地记忆？它不会再参与未来对话。")) return;
    try {
      const response = await fetch(`${API_BASE}/v1/memories/${memory.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Memory unavailable");
      await refreshRelationshipData();
      setMessages((current) => current.map((message) => (
        message.memoryId === memory.id
          ? { ...message, memoryId: undefined, systemNote: `${message.systemNote ?? ""} 这条候选未被保存。`.trim() }
          : message
      )));
      setRelationshipStatus("已删除本地记忆。 ");
    } catch {
      setRelationshipStatus("删除记忆失败，请稍后重试。");
    }
  }

  async function deleteConversation(summary: ConversationSummary) {
    if (!window.confirm(`删除“${summary.title}”及其消息和关联记忆？此操作无法撤销。`)) return;
    try {
      const response = await fetch(`${API_BASE}/v1/conversations/${summary.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Conversation unavailable");
      if (conversationId === summary.id) {
        setConversationId(null);
        switchMode(mode);
      }
      await refreshRelationshipData();
      setRelationshipStatus("已删除这段本地对话及其关联记忆。");
    } catch {
      setRelationshipStatus("删除对话失败，请稍后重试。");
    }
  }

  async function downloadExport() {
    try {
      const response = await fetch(`${API_BASE}/v1/export`);
      if (!response.ok) throw new Error("Export unavailable");
      const blob = new Blob([await response.text()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `bookmate-local-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setRelationshipStatus("已导出会话、记忆和书库元数据；原始书籍文件不会自动打包。 ");
    } catch {
      setRelationshipStatus("导出失败，请确认本地 API 正在运行。");
    }
  }

  useEffect(() => {
    let active = true;
    async function loadLocalSetup() {
      try {
        const [settingsResponse, documentsResponse, profilesResponse, readerResponse] = await Promise.all([
          fetch(`${API_BASE}/v1/settings/model`),
          fetch(`${API_BASE}/v1/knowledge/documents`),
          fetch(`${API_BASE}/v1/settings/models`),
          fetch(`${API_BASE}/v1/settings/reader`),
        ]);
        if (!settingsResponse.ok || !documentsResponse.ok || !profilesResponse.ok || !readerResponse.ok) return;
        const [settings, localDocuments, profiles, reader] = await Promise.all([
          settingsResponse.json(),
          documentsResponse.json(),
          profilesResponse.json(),
          readerResponse.json(),
        ]);
        if (!active) return;
        setModelSettings(settings);
        setDocuments(localDocuments);
        setModelProfiles(profiles);
        setReaderProfile(reader);
        setReaderDisplayName(reader.display_name);
        setSetupStatus(
          settings.base_url && settings.model
            ? `已准备好 ${modelNameForDisplay(settings.model)}。`
            : "还没有可用模型。添加一个后即可开始对话。",
        );
      } catch {
        // The main page remains usable as an offline preview.
      }
    }
    loadLocalSetup();
    return () => {
      active = false;
    };
  }, []);

  async function refreshModelProfiles(preferredId?: string | null) {
    try {
      const response = await fetch(`${API_BASE}/v1/settings/models`);
      if (!response.ok) return;
      const profiles: ModelProfile[] = await response.json();
      setModelProfiles(profiles);
      setSelectedModelProfileId((current) => {
        if (preferredId && profiles.some((profile) => profile.id === preferredId)) return preferredId;
        if (current && profiles.some((profile) => profile.id === current)) return current;
        return current ? profiles.find((profile) => profile.is_default)?.id ?? profiles[0]?.id ?? null : null;
      });
    } catch {
      setSetupStatus("无法读取模型列表，请确认应用已启动。");
    }
  }

  async function saveReaderProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSetupPending(true);
    setSetupStatus("正在保存本地界面配置……");
    try {
      const response = await fetch(`${API_BASE}/v1/settings/reader`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: readerDisplayName.trim() }),
      });
      if (!response.ok) throw new Error(await response.text());
      const profile: ReaderProfile = await response.json();
      setReaderProfile(profile);
      setReaderDisplayName(profile.display_name);
      setSetupStatus(profile.display_name ? `已将本地界面称呼设为“${profile.display_name}”。` : "已恢复默认的界面称呼。");
    } catch (error) {
      setSetupStatus(`保存用户配置失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setSetupPending(false);
    }
  }

  async function saveModelProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSetupPending(true);
    setSetupStatus("正在保存模型……");
    try {
      const editingProfile = modelProfiles.find((profile) => profile.id === editingModelProfileId) ?? null;
      const payload: Record<string, string | number | boolean | null> = {
        name: modelProfileName.trim() || modelNameForDisplay(modelDraft.model),
        protocol: modelDraft.protocol,
        base_url: modelDraft.base_url,
        model: modelDraft.model,
        timeout_seconds: modelDraft.timeout_seconds,
      };
      if (apiKey.trim()) payload.api_key = apiKey.trim();
      if (!editingProfile) {
        payload.api_key = apiKey.trim() || null;
        payload.set_as_default = modelProfiles.length === 0;
      }
      const response = await fetch(
        editingProfile ? `${API_BASE}/v1/settings/models/${editingProfile.id}` : `${API_BASE}/v1/settings/models`,
        {
        method: editingProfile ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        },
      );
      if (!response.ok) throw new Error(await response.text());
      const profile: ModelProfile = await response.json();
      setApiKey("");
      setModelProfileName("");
      setEditingModelProfileId(null);
      setModelDraft(emptyModelSettings());
      await refreshModelProfiles(profile.id);
      setSetupStatus(`“${profileNameForDisplay(profile)}”已保存，并将在本轮对话使用。`);
    } catch (error) {
      setSetupStatus(`保存失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setSetupPending(false);
    }
  }

  function beginModelProfileEdit(profile: ModelProfile) {
    setEditingModelProfileId(profile.id);
    setModelProfileName(profile.name);
    setModelDraft({
      protocol: profile.protocol,
      base_url: profile.base_url,
      model: profile.model,
      api_key_configured: profile.api_key_configured,
      timeout_seconds: profile.timeout_seconds,
      source: profile.source,
    });
    setApiKey("");
    setSetupStatus(`正在编辑“${profileNameForDisplay(profile)}”。访问密钥留空即可保留。`);
  }

  function cancelModelProfileEdit() {
    setEditingModelProfileId(null);
    setModelProfileName("");
    setApiKey("");
    setModelDraft(emptyModelSettings());
  }

  async function testModelProfile(profile: ModelProfile) {
    setSetupPending(true);
    setSetupStatus(`正在确认“${profileNameForDisplay(profile)}”是否可用……`);
    try {
      const response = await fetch(`${API_BASE}/v1/settings/models/${profile.id}/test`, { method: "POST" });
      const result = await response.json();
      setSetupStatus(
        result.ok
          ? `“${profileNameForDisplay(profile)}”已可用 · 用时 ${result.latency_ms}ms`
          : `暂时无法使用 · ${result.message}`,
      );
    } catch (error) {
      setSetupStatus(`连接失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setSetupPending(false);
    }
  }

  async function testEnvironmentModel() {
    setSetupPending(true);
    setSetupStatus(`正在确认“${modelNameForDisplay(modelSettings.model)}”是否可用……`);
    try {
      const response = await fetch(`${API_BASE}/v1/settings/model/test`, { method: "POST" });
      const result = await response.json();
      setSetupStatus(
        result.ok
          ? `“${modelNameForDisplay(result.model)}”已可用 · 用时 ${result.latency_ms}ms`
          : `暂时无法使用 · ${result.message || "模型服务没有返回可读结果"}`,
      );
    } catch (error) {
      setSetupStatus(`确认模型失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setSetupPending(false);
    }
  }

  async function setDefaultModelProfile(profile: ModelProfile) {
    setSetupPending(true);
    try {
      const response = await fetch(`${API_BASE}/v1/settings/models/${profile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ set_as_default: true }),
      });
      if (!response.ok) throw new Error(await response.text());
      await refreshModelProfiles(profile.id);
      setSetupStatus(`“${profileNameForDisplay(profile)}”已设为新对话默认模型。`);
    } catch (error) {
      setSetupStatus(`更新默认模型失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setSetupPending(false);
    }
  }

  async function removeModelProfile(profile: ModelProfile) {
    if (!window.confirm(`移除“${profileNameForDisplay(profile)}”？这不会影响模型服务。`)) return;
    setSetupPending(true);
    try {
      const response = await fetch(`${API_BASE}/v1/settings/models/${profile.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await response.text());
      await refreshModelProfiles();
      setSetupStatus(`“${profileNameForDisplay(profile)}”已移除。`);
    } catch (error) {
      setSetupStatus(`移除模型配置失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setSetupPending(false);
    }
  }

  async function uploadDocument(file: File | undefined, targetBookId = selectedLibraryBookId) {
    if (!file) return;
    setSetupPending(true);
    setSetupStatus(`正在本机解析《${file.name}》……`);
    const form = new FormData();
    form.append("file", file);
    if (targetBookId) form.append("book_id", targetBookId);
    try {
      const response = await fetch(`${API_BASE}/v1/knowledge/documents`, { method: "POST", body: form });
      if (!response.ok) throw new Error(await response.text());
      const document = await response.json();
      const owner = libraryBooks.find((book) => book.id === document.book_id) ?? null;
      setDocuments((current) => [document, ...current]);
      setSelectedDocumentId(document.id);
      if (document.book_id) setSelectedLibraryBookId(document.book_id);
      setActiveBookId(null);
      setActiveBookTitle(owner?.title ?? document.name);
      switchMode("book_room", owner?.title ?? document.name);
      refreshLibraryData();
      setSetupStatus(`《${document.name}》已在本机建立 ${document.chunk_count} 个文本片段。`);
    } catch (error) {
      setSetupStatus(`导入失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setSetupPending(false);
    }
  }

  async function removeDocument(document: KnowledgeDocument) {
    if (!window.confirm(`删除《${document.name}》及其本地索引？此操作不会删除你的原始购书文件。`)) return;
    const response = await fetch(`${API_BASE}/v1/knowledge/documents/${document.id}`, { method: "DELETE" });
    if (!response.ok) {
      setSetupStatus("删除失败，请稍后重试。");
      return;
    }
    setDocuments((current) => current.filter((item) => item.id !== document.id));
    if (selectedDocumentId === document.id) setSelectedDocumentId(null);
    // The shelf item remains the active conversation context even if one version is removed.
    if (document.book_id) refreshLibraryData();
    setSetupStatus(`已删除《${document.name}》的 BookMate 本地副本和索引。`);
  }

  async function reassignDocument(document: KnowledgeDocument, bookId: string) {
    const nextBookId = bookId || null;
    try {
      const form = new FormData();
      if (nextBookId) form.append("book_id", nextBookId);
      const response = await fetch(`${API_BASE}/v1/knowledge/documents/${document.id}/book`, {
        method: "PATCH",
        body: form,
      });
      if (!response.ok) throw new Error(await response.text());
      const updated: KnowledgeDocument = await response.json();
      const owner = libraryBooks.find((book) => book.id === updated.book_id) ?? null;
      setDocuments((current) => current.map((item) => item.id === updated.id ? updated : item));
      if (selectedDocumentId === updated.id) {
        setSelectedLibraryBookId(updated.book_id);
        setActiveBookTitle(owner?.title ?? updated.name);
      }
      await refreshLibraryData();
      setSetupStatus(owner
        ? `《${updated.name}》已归入《${owner.title}》。`
        : `《${updated.name}》已移回未归档资料。`);
    } catch (error) {
      setSetupStatus(`调整归档失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  async function sendMessage(rawMessage: string) {
    const message = rawMessage.trim();
    if (!message || pending) return;

    const readerMessage: Message = {
      id: `reader-${Date.now()}`,
      role: "reader",
      text: message,
    };
    setMessages((current) => [...current, readerMessage]);
    setInput("");
    setPending(true);
    let receivedResponse = false;

    try {
      const response = await fetch(`${API_BASE}/v1/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          conversation_id: conversationId,
          mode,
          book_id: mode === "book_room" && !activeDocument ? activeBookId : null,
          book_title: mode === "book_room" && !activeBookId ? activeBookTitle : null,
          knowledge_document_id: mode === "book_room" ? activeDocument?.id ?? null : null,
          library_book_id: mode === "book_room" ? selectedLibraryBookId : null,
          model_profile_id: selectedModelProfileId,
          direction,
          search_policy: searchPolicy,
        }),
      });
      receivedResponse = true;
      if (!response.ok) throw await chatErrorFromResponse(response);
      const data = await response.json();
      if (data.conversation_id) setConversationId(data.conversation_id);
      const notes = [
        data.citations?.length ? `本轮参考了 ${data.citations.length} 条本地资料或阅读痕迹，可在后续证据抽屉中核验。` : undefined,
        searchDecisionNote(data.search_decision?.action),
      ].filter(Boolean);
      setMessages((current) => [
        ...current,
        {
          id: `companion-${Date.now()}`,
          role: "companion",
          text: `${data.reply}\n\n${data.follow_up}`,
          move: flowMoveLabel(data.flow_move),
          systemNote: notes.length ? notes.join(" ") : undefined,
          memoryId: data.memory_candidate_id ?? undefined,
          memoryText: data.memory_candidate ?? undefined,
        },
      ]);
      setApiOnline(true);
      refreshRelationshipData();
    } catch (error) {
      const chatError = error instanceof ChatResponseError
        ? error
        : new ChatResponseError(
          receivedResponse
            ? "这次没有得到完整回应。请重新发送。"
            : "暂时无法连接 BookMate。请确认应用仍在运行后重新发送。",
          "retry",
        );
      setApiOnline(receivedResponse);
      setMessages((current) => [
        ...current,
        {
          id: `chat-error-${Date.now()}`,
          role: "companion",
          text: chatError.message,
          move: "稍后再试",
          errorAction: chatError.action,
          retryText: message,
        },
      ]);
    } finally {
      setPending(false);
    }
  }

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  return (
    <main className="page-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar reveal reveal-one">
        <div className="brand-lockup">
          <span className="brand-mark">泊</span>
          <div>
            <p className="brand-name">泊舟</p>
            <p className="brand-subtitle">与你把书谈深的 AI 书友</p>
          </div>
        </div>
        <div className="topbar-actions">
          <label className="search-policy">
            <span>联网</span>
            <select
              aria-label="联网搜索策略"
              onChange={(event) => setSearchPolicy(event.target.value as SearchPolicy)}
              value={searchPolicy}
            >
              {(Object.keys(searchPolicyLabels) as SearchPolicy[]).map((policy) => (
                <option key={policy} value={policy}>{searchPolicyLabels[policy]}</option>
              ))}
            </select>
          </label>
          <span className={`status ${apiOnline === false ? "status-offline" : ""}`}>
            <i />
            {apiOnline === null ? "正在准备" : apiOnline ? "BookMate 已启动" : "离线预览"}
          </span>
          <button className="import-center-button" onClick={() => setShowImportCenter(true)} type="button">
            导入中心 <span>{documents.length}</span>
          </button>
          <button className="local-setup-button" onClick={() => setShowLocalSetup(true)} type="button">
            本地书库 <span>{documents.length}</span>
          </button>
          <button className="memory-button" onClick={() => setShowRelationship(true)} type="button">
            我们记得的事 <span>{memories.filter((memory) => memory.status === "confirmed").length}</span>
          </button>
        </div>
      </header>

      {showRelationship && (
        <div className="setup-backdrop" role="presentation" onMouseDown={() => setShowRelationship(false)}>
          <section
            aria-label="本地对话与记忆"
            aria-modal="true"
            className="relationship-drawer"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="setup-heading">
              <div>
                <p className="overline">Continuity, not surveillance</p>
                <h2>我们记得的事</h2>
              </div>
              <button aria-label="关闭对话与记忆" onClick={() => setShowRelationship(false)} type="button">×</button>
            </div>
            <p className="privacy-callout">
              对话保存在你的电脑里。只有你确认的记忆才会在未来被带入；待确认候选不会自动变成长期画像。
            </p>

            <div className="relationship-section">
              <div className="setup-section-title">
                <span>01</span><div><h3>继续一段对话</h3><p>每段对话都可单独删除</p></div>
              </div>
              <div className="conversation-list">
                {conversations.length === 0 && <p className="empty-library">还没有保存的对话。第一轮认真聊天后，它会出现在这里。</p>}
                {conversations.map((conversation) => (
                  <article className={conversation.id === conversationId ? "selected" : ""} key={conversation.id}>
                    <button className="conversation-select" onClick={() => continueConversation(conversation)} type="button">
                      <strong>{conversation.title}</strong>
                      <small>{conversation.book_title ?? "广泛书友"} · {conversation.message_count} 条消息</small>
                    </button>
                    <button className="document-delete" onClick={() => deleteConversation(conversation)} type="button">删除</button>
                  </article>
                ))}
              </div>
            </div>

            <div className="relationship-section">
              <div className="setup-section-title">
                <span>02</span><div><h3>待你确认的记忆</h3><p>确认后才会参与以后对话</p></div>
              </div>
              <div className="memory-list">
                {memories.filter((memory) => memory.status === "pending").length === 0 && <p className="empty-library">没有待确认的候选。</p>}
                {memories.filter((memory) => memory.status === "pending").map((memory) => (
                  <article key={memory.id}>
                    <p>{memory.content}</p>
                    <div><span>{memoryScopeLabel(memory.scope)}</span><button onClick={() => confirmMemory(memory)} type="button">确认</button><button onClick={() => removeMemory(memory)} type="button">不保存</button></div>
                  </article>
                ))}
              </div>
            </div>

            <div className="relationship-section confirmed-memories">
              <div className="setup-section-title">
                <span>03</span><div><h3>已经确认的线索</h3><p>可以随时删除或重新开始</p></div>
              </div>
              <div className="memory-list">
                {memories.filter((memory) => memory.status === "confirmed").length === 0 && <p className="empty-library">还没有长期线索。</p>}
                {memories.filter((memory) => memory.status === "confirmed").map((memory) => (
                  <article key={memory.id}>
                    <p>{memory.content}</p>
                    <div><span>{memoryScopeLabel(memory.scope)}</span><button onClick={() => removeMemory(memory)} type="button">删除</button></div>
                  </article>
                ))}
              </div>
            </div>

            <div className="relationship-export">
              <button onClick={downloadExport} type="button">导出我的本地数据</button>
              <p>导出会话、记忆和书库元数据；不会自动包含原始书籍文件或 API Key。</p>
            </div>
            <p className="setup-status" aria-live="polite">{relationshipStatus}</p>
          </section>
        </div>
      )}

      {showImportCenter && (
        <div className="import-backdrop" role="presentation" onMouseDown={() => setShowImportCenter(false)}>
          <section
            aria-label="导入中心"
            aria-modal="true"
            className="import-workbench"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="import-heading">
              <div>
                <p className="overline">Bring your reading in</p>
                <h2>导入中心</h2>
                <p>先决定内容属于哪本书，再选择最自然的带入方式。导入不会覆盖你原有的书目、笔记或文件。</p>
              </div>
              <button aria-label="关闭导入中心" onClick={() => setShowImportCenter(false)} type="button">×</button>
            </header>

            <div className="import-stats" aria-label="本地资料概览">
              <div><strong>{libraryBooks.length}</strong><span>本书书房</span></div>
              <div><strong>{documents.length}</strong><span>本地文件</span></div>
              <div><strong>{documents.filter((document) => !document.book_id).length}</strong><span>待归档资料</span></div>
            </div>

            <nav className="import-tabs" aria-label="选择导入方式">
              <button className={importTab === "files" ? "active" : ""} onClick={() => setImportTab("files")} type="button">
                <span>01</span><strong>文件与版本</strong><small>EPUB、PDF、TXT、Markdown</small>
              </button>
              <button className={importTab === "notes" ? "active" : ""} onClick={() => setImportTab("notes")} type="button">
                <span>02</span><strong>阅读痕迹</strong><small>摘录、感想与问题</small>
              </button>
              <button className={importTab === "books" ? "active" : ""} onClick={() => setImportTab("books")} type="button">
                <span>03</span><strong>先建一本书</strong><small>没有文件也能开始</small>
              </button>
            </nav>

            {importTab === "files" && (
              <section className="import-stage">
                <div className="import-stage-heading">
                  <div><p className="overline">File import</p><h3>把版本或资料放进书房</h3></div>
                  <label className="import-target"><span>归属书房</span><select onChange={(event) => setImportTargetBookId(event.target.value || null)} value={importTargetBookId ?? ""}><option value="">暂不归档</option>{libraryBooks.map((book) => <option key={book.id} value={book.id}>《{book.title}》</option>)}</select></label>
                </div>
                <label
                  className="import-dropzone"
                  onDragOver={(event: DragEvent<HTMLLabelElement>) => event.preventDefault()}
                  onDrop={(event: DragEvent<HTMLLabelElement>) => {
                    event.preventDefault();
                    uploadDocument(event.dataTransfer.files?.[0], importTargetBookId);
                  }}
                >
                  <input
                    accept=".txt,.md,.pdf,.epub"
                    disabled={setupPending}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      uploadDocument(file, importTargetBookId);
                    }}
                    type="file"
                  />
                  <span className="import-drop-mark">FILE</span>
                  <strong>选择文件，或把文件拖到这里</strong>
                  <small>支持 EPUB、PDF、TXT、Markdown；默认最大 50 MB。不会修改你的原始文件。</small>
                </label>
                <div className="import-list-heading"><div><h4>已导入资料</h4><p>资料可以随时重新归档，导入完成后可直接进入对应书房聊天。</p></div><div className="document-filter"><button className={documentFilter === "all" ? "active" : ""} onClick={() => setDocumentFilter("all")} type="button">全部 {documents.length}</button><button className={documentFilter === "unfiled" ? "active" : ""} onClick={() => setDocumentFilter("unfiled")} type="button">待归档 {documents.filter((document) => !document.book_id).length}</button></div></div>
                <div className="import-document-list">
                  {visibleImportDocuments.length === 0 && <p className="empty-library">这里还没有符合条件的资料。可以先导入一个版本，或在“先建一本书”中创建书房。</p>}
                  {visibleImportDocuments.map((document) => (
                    <article key={document.id}>
                      <button className="document-select" onClick={() => {
                        setSelectedDocumentId(document.id);
                        setSelectedLibraryBookId(document.book_id);
                        const owner = libraryBooks.find((book) => book.id === document.book_id);
                        if (document.book_id) loadBookRoomDetails(document.book_id);
                        else setReadingNotes([]);
                        setActiveBookId(null);
                        setActiveBookTitle(owner?.title ?? document.name);
                        switchMode("book_room", owner?.title ?? document.name);
                        setShowImportCenter(false);
                      }} type="button">
                        <span className="file-mark">{document.extension.slice(1).toUpperCase()}</span>
                        <span><strong>{document.name}</strong><small>{libraryBooks.find((book) => book.id === document.book_id)?.title ?? "待归档"} · {document.chunk_count} 个片段 · {formatBytes(document.size_bytes)}</small></span>
                      </button>
                      <select aria-label={`调整《${document.name}》的归属`} className="document-assignment" disabled={setupPending} onChange={(event) => reassignDocument(document, event.target.value)} value={document.book_id ?? ""}><option value="">待归档</option>{libraryBooks.map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}</select>
                      <button className="document-delete" onClick={() => removeDocument(document)} type="button">删除</button>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {importTab === "notes" && (
              <section className="import-stage">
                <div className="import-stage-heading">
                  <div><p className="overline">Reading capture</p><h3>先留下让你停住的地方</h3></div>
                  <label className="import-target"><span>留给哪本书</span><select disabled={libraryBooks.length === 0} onChange={(event) => setImportTargetBookId(event.target.value || null)} value={importTargetBookId ?? ""}><option value="">选择一本书</option>{libraryBooks.map((book) => <option key={book.id} value={book.id}>《{book.title}》</option>)}</select></label>
                </div>
                {libraryBooks.length === 0 ? <p className="empty-library">阅读痕迹需要有一个书房。请先在“先建一本书”中添加书目；没有电子书也完全可以。</p> : (
                  <form className="import-note-form" onSubmit={(event) => captureReadingNote(event, importTargetBookId)}>
                    <label><span>类型</span><select defaultValue="reflection" name="kind">{(Object.keys(readingNoteKindLabels) as ReadingNoteKind[]).map((kind) => <option key={kind} value={kind}>{readingNoteKindLabels[kind]}</option>)}</select></label>
                    <label><span>位置</span><input name="locator" placeholder="可选：第三章、页码、进度" /></label>
                    <label className="import-note-wide"><span>原文或划线</span><textarea name="quote" placeholder="可选；没有原文也没关系" /></label>
                    <label className="import-note-wide"><span>你的想法</span><textarea name="content" placeholder="写下你想继续聊的判断、感受或问题……" required /></label>
                    <button disabled={setupPending || !importTargetBookId} type="submit">保存到书房</button>
                  </form>
                )}
              </section>
            )}

            {importTab === "books" && (
              <section className="import-stage">
                <div className="import-stage-heading"><div><p className="overline">A room before a file</p><h3>先为一本书留出位置</h3><p>实体书、阅读 App 里的书，或只剩印象的作品，都可以先建立书房。</p></div></div>
                <form className="import-book-form" onSubmit={createLibraryBook}>
                  <label><span>书名</span><input onChange={(event) => setNewBookTitle(event.target.value)} placeholder="例如：《局外人》" value={newBookTitle} /></label>
                  <label><span>作者</span><input onChange={(event) => setNewBookAuthor(event.target.value)} placeholder="可选" value={newBookAuthor} /></label>
                  <label><span>阅读状态</span><select onChange={(event) => setNewBookStatus(event.target.value as ReadingStatus)} value={newBookStatus}>{(Object.keys(readingStatusLabels) as ReadingStatus[]).map((status) => <option key={status} value={status}>{readingStatusLabels[status]}</option>)}</select></label>
                  <button disabled={setupPending || !newBookTitle.trim()} type="submit">建立书房</button>
                </form>
                <p className="import-assurance">建立书房不会要求上传文件。之后可继续导入版本、保存阅读痕迹，或直接开始聊天。</p>
              </section>
            )}

            <p className="import-status" aria-live="polite">{setupStatus}</p>
          </section>
        </div>
      )}

      {showPreferences && (
        <div className="setup-backdrop" role="presentation" onMouseDown={() => setShowPreferences(false)}>
          <section
            aria-label="偏好与模型"
            aria-modal="true"
            className="preferences-drawer"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="setup-heading">
              <div>
                <p className="overline">Your space, your choice</p>
                <h2>偏好与模型</h2>
              </div>
              <button aria-label="关闭偏好与模型" onClick={() => setShowPreferences(false)} type="button">×</button>
            </div>

            <p className="privacy-callout">
              这是你的个人设置，与书架和阅读痕迹分开。使用远程模型时，当轮需要的内容会发送给你选择的服务。
            </p>

            <form className="reader-profile-form" onSubmit={saveReaderProfile}>
              <div className="setup-section-title">
                <span>01</span><div><h3>你的称呼</h3><p>它只会显示在这台设备的界面中。</p></div>
              </div>
              <label>
                <span>界面称呼</span>
                <input
                  maxLength={80}
                  onChange={(event) => setReaderDisplayName(event.target.value)}
                  placeholder="例如：小林"
                  value={readerDisplayName}
                />
              </label>
              <div className="setup-actions">
                <button className="model-save" disabled={setupPending} type="submit">保存</button>
              </div>
            </form>

            <div className="model-profile-manager">
              <div className="setup-section-title">
                <span>02</span><div><h3>书友模型</h3><p>选择这次想使用的模型；每次对话都可以换一个声音。</p></div>
              </div>
              <div className="model-profile-list">
                {modelSettings.model && (
                  <article className={!selectedModelProfileId ? "selected" : ""}>
                    <button className="model-profile-select" onClick={() => setSelectedModelProfileId(null)} type="button">
                      <span className="model-profile-mark">AI</span>
                      <span>
                        <strong>{modelNameForDisplay(modelSettings.model)}</strong>
                        <small>已准备好，可直接开始。</small>
                      </span>
                    </button>
                    <div className="model-profile-actions">
                      {!selectedModelProfileId && <span>正在使用</span>}
                      <button disabled={setupPending || !modelSettings.base_url} onClick={testEnvironmentModel} type="button">试一试</button>
                    </div>
                  </article>
                )}
                {!modelSettings.model && modelProfiles.length === 0 && <p className="empty-library">还没有可用模型。添加一个后，泊舟就能开始回应。</p>}
                {modelProfiles.map((profile) => (
                  <article className={selectedModelProfileId === profile.id ? "selected" : ""} key={profile.id}>
                    <button className="model-profile-select" onClick={() => setSelectedModelProfileId(profile.id)} type="button">
                      <span className="model-profile-mark">AI</span>
                      <span>
                        <strong>{profileNameForDisplay(profile)}</strong>
                        <small>{profile.is_default ? "新对话默认使用" : "可用于本轮对话"}</small>
                      </span>
                    </button>
                    <div className="model-profile-actions">
                      <button disabled={setupPending} onClick={() => beginModelProfileEdit(profile)} type="button">编辑</button>
                      {selectedModelProfileId === profile.id ? <span>正在使用</span> : profile.is_default ? <span>新对话默认</span> : <button disabled={setupPending} onClick={() => setDefaultModelProfile(profile)} type="button">设为默认</button>}
                      <button disabled={setupPending} onClick={() => testModelProfile(profile)} type="button">试一试</button>
                      <button disabled={setupPending} onClick={() => removeModelProfile(profile)} type="button">移除</button>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <form className="model-form" onSubmit={saveModelProfile}>
              <div className="setup-section-title">
                <span>03</span><div><h3>{editingModelProfileId ? "编辑模型" : "添加模型"}</h3><p>给它起一个在聊天时一眼能认出的名字。</p></div>
              </div>
              <label>
                <span>显示名称</span>
                <input
                  onChange={(event) => setModelProfileName(event.target.value)}
                  placeholder="例如：深度交谈 / 本地轻聊"
                  value={modelProfileName}
                />
              </label>
              <label>
                <span>服务类型</span>
                <select
                  onChange={(event) => setModelDraft({ ...modelDraft, protocol: event.target.value as ModelProtocol })}
                  value={modelDraft.protocol}
                >
                  <option value="chat_completions">通用兼容</option>
                  <option value="responses">Responses</option>
                </select>
              </label>
              <label>
                <span>服务地址</span>
                <input
                  onChange={(event) => setModelDraft({ ...modelDraft, base_url: event.target.value })}
                  placeholder="例如：http://127.0.0.1:11434/v1"
                  type="url"
                  value={modelDraft.base_url}
                />
              </label>
              <label>
                <span>模型名称</span>
                <input
                  onChange={(event) => setModelDraft({ ...modelDraft, model: event.target.value })}
                  placeholder="例如：qwen3.5:4b"
                  value={modelDraft.model}
                />
              </label>
              <label>
                <span>访问密钥 {modelDraft.api_key_configured && <em>已保存</em>}</span>
                <input
                  autoComplete="off"
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={modelDraft.api_key_configured ? "留空则保持现有密钥" : "本地服务通常可留空"}
                  type="password"
                  value={apiKey}
                />
              </label>
              <div className="setup-actions">
                {editingModelProfileId && <button disabled={setupPending} onClick={cancelModelProfileEdit} type="button">取消</button>}
                <button className="model-save" disabled={setupPending || !modelDraft.base_url || !modelDraft.model} type="submit">{editingModelProfileId ? "保存修改" : "保存模型"}</button>
              </div>
            </form>

            <p className="setup-status" aria-live="polite">{setupStatus}</p>
          </section>
        </div>
      )}

      {showLocalSetup && (
        <div className="setup-backdrop" role="presentation" onMouseDown={() => setShowLocalSetup(false)}>
          <section
            aria-label="本地书库"
            aria-modal="true"
            className="setup-drawer"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="setup-heading">
              <div>
                <p className="overline">Your local library</p>
                <h2>管理你的本地书库</h2>
              </div>
              <button aria-label="关闭本地书库" onClick={() => setShowLocalSetup(false)} type="button">×</button>
            </div>

            <p className="privacy-callout">
              书籍、阅读痕迹、文件与索引都保存在本机。模型连接及个人界面配置在左下角的“偏好与模型设置”中单独管理。
            </p>

            <div className="library-shelf-manager">
              <div className="setup-section-title">
                <span>01</span><div><h3>我的书架</h3><p>作品独立于文件、笔记和对话存在</p></div>
              </div>
              <button className="library-import-link" onClick={() => { setShowLocalSetup(false); setShowImportCenter(true); setImportTab("books"); }} type="button">导入一本书、资料或阅读痕迹 <span>↗</span></button>
              <div className="shelf-list">
                {libraryBooks.length === 0 && <p className="empty-library">先添加一本书；之后可以为它绑定多个版本、笔记和资料。</p>}
                {libraryBooks.map((book) => (
                  <article className={selectedLibraryBookId === book.id ? "selected" : ""} key={book.id}>
                    <button className="shelf-select" onClick={() => selectLibraryBook(book)} type="button">
                      <span className="shelf-spine">{book.title.slice(0, 1)}</span>
                      <span><strong>{book.title}</strong><small>{book.author ?? "作者待补充"} · {book.note_count} 条阅读痕迹 · {book.document_count} 份资料</small></span>
                    </button>
                    <select
                      aria-label={`更新《${book.title}》的阅读状态`}
                      onChange={(event) => updateReadingStatus(book, event.target.value as ReadingStatus)}
                      value={book.reading_status}
                    >
                      {(Object.keys(readingStatusLabels) as ReadingStatus[]).map((status) => (
                        <option key={status} value={status}>{readingStatusLabels[status]}</option>
                      ))}
                    </select>
                    <button className="document-delete" onClick={() => removeLibraryBook(book)} type="button">移除</button>
                  </article>
                ))}
              </div>
            </div>

            <div className="book-room-manager">
              <div className="setup-section-title">
                <span>02</span><div><h3>这本书，怎样陪你聊</h3><p>不上传全文，也可以先设定书房与剧透边界</p></div>
              </div>
              {!selectedLibraryBook && <p className="empty-library">先在书架中选择一本书。实体书、阅读 App 里的书和只有读后印象的书都可以。</p>}
              {selectedLibraryBook && (
                <form className="book-room-form" key={selectedLibraryBook.id} onSubmit={saveBookRoomSettings}>
                  <label><span>ISBN / 条码</span><input defaultValue={selectedLibraryBook.isbn ?? ""} name="isbn" placeholder="可手动输入，扫码入口将随后加入" /></label>
                  <label><span>我读到</span><input defaultValue={selectedLibraryBook.reading_progress ?? ""} name="reading_progress" placeholder="例如：第三章、58%、已读完" /></label>
                  <label><span>剧透边界</span><select defaultValue={selectedLibraryBook.spoiler_policy} name="spoiler_policy">{(Object.keys(spoilerPolicyLabels) as SpoilerPolicy[]).map((policy) => <option key={policy} value={policy}>{spoilerPolicyLabels[policy]}</option>)}</select></label>
                  <label><span>书友姿态</span><select defaultValue={selectedLibraryBook.companion_stance} name="companion_stance">{(Object.keys(companionStanceLabels) as CompanionStance[]).map((stance) => <option key={stance} value={stance}>{companionStanceLabels[stance]}</option>)}</select></label>
                  <label className="book-room-intent"><span>这次想聊什么</span><textarea defaultValue={selectedLibraryBook.room_intent ?? ""} name="room_intent" placeholder="例如：别急着总结，帮我把我对结局的抵触说清楚。" /></label>
                  <button disabled={setupPending} type="submit">保存书房规则</button>
                </form>
              )}
            </div>

            <div className="reading-capture-manager">
              <div className="setup-section-title">
                <span>03</span><div><h3>随手留下阅读痕迹</h3><p>一段摘录、一句感想或一个问题，就足够开始</p></div>
              </div>
              {!selectedLibraryBook && <p className="empty-library">选择书架项目后，可以粘贴阅读 App 的划线，或记下实体书中让你停住的地方。</p>}
              {selectedLibraryBook && (
                <>
                  <form className="reading-capture-form" onSubmit={captureReadingNote}>
                    <select defaultValue="reflection" name="kind">
                      {(Object.keys(readingNoteKindLabels) as ReadingNoteKind[]).map((kind) => <option key={kind} value={kind}>{readingNoteKindLabels[kind]}</option>)}
                    </select>
                    <input name="locator" placeholder="位置（可选）：第三章、页码、进度" />
                    <textarea name="quote" placeholder="原文或划线（可选；没有也完全可以）" />
                    <textarea name="content" placeholder="你想留下什么？例如：我不同意大家把这里理解成宽恕。" required />
                    <button disabled={setupPending} type="submit">留在这本书里</button>
                  </form>
                  <div className="reading-note-list">
                    {readingNotes.length === 0 && <p className="empty-library">还没有阅读痕迹。你不需要整理好才开始聊。</p>}
                    {readingNotes.map((note) => (
                      <article key={note.id}>
                        <span>{readingNoteKindLabels[note.kind]}</span>
                        <div>{note.quote && <blockquote>{note.quote}</blockquote>}<p>{note.content}</p>{note.locator && <small>{note.locator}</small>}</div>
                        <button aria-label="删除阅读痕迹" className="document-delete" onClick={() => removeReadingNote(note)} type="button">删除</button>
                      </article>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="library-manager">
              <div className="setup-section-title">
                <span>04</span><div><h3>版本与资料</h3><p>导入、重新归档与批量查看都在独立工作台中完成</p></div>
              </div>
              <button className="library-import-link" onClick={() => { setShowLocalSetup(false); setShowImportCenter(true); setImportTab("files"); }} type="button">打开导入中心管理 {documents.length} 份本地资料 <span>↗</span></button>
            </div>

            <p className="setup-status" aria-live="polite">{setupStatus}</p>
          </section>
        </div>
      )}

      <section className="workspace">
        <aside className="companion-panel reveal reveal-two">
          <div className="portrait-wrap">
            <div className="portrait">舟</div>
            <span className="ai-label">AI</span>
          </div>
          <p className="overline">由你的阅读，慢慢认识你</p>
          <h1>泊舟</h1>
          <p className="identity-copy">
            书合上以后，问题还在。我会带着你愿意留下的线索，陪你把那句没说完的话继续说下去。
          </p>

          <div className="temperament">
            <span>先听你说完</span><span>不只会赞同</span><span>记得未完的问题</span>
          </div>

          <div className="thread-card">
            <p className="overline">泊舟相信</p>
            <blockquote>共频，不是拥有相同的答案，而是愿意沿着彼此的思路，再往深处走一点。</blockquote>
            <div className="thread-line"><i /></div>
            <small>你的书、感受与确认过的记忆，让每次重逢都能从上次停下的地方继续。</small>
          </div>

          <div className="boundary-note">
            <span>始终坦诚</span>
            <p>泊舟是一位 AI 书友，不冒充真人，不虚构经历、引文或理解。</p>
          </div>
          <button className="preferences-entry" onClick={() => setShowPreferences(true)} type="button">
            <span className="preferences-entry-mark">SET</span>
            <span><strong>偏好与模型</strong><small>{readerProfile.display_name ? `${readerProfile.display_name} · 你的个人设置` : "称呼与书友模型"}</small></span>
          </button>
        </aside>

        <section className="conversation-panel reveal reveal-three">
          <div className="book-heading">
            <div>
              <p className="overline">{mode === "book_room" ? "此刻共同谈论" : "开放书友空间"}</p>
              <h2>{mode === "book_room" ? `《${activeBookTitle}》` : "从你的问题出发"}</h2>
              <p>{mode === "book_room" ? (activeDocument ? "你的本地资料 · 按需取证" : "阿尔贝·加缪 · 已读交流") : "不绑定书籍 · 跨作品、生活与思想"}</p>
            </div>
            <div className="book-heading-actions">
              <div className="mode-switch" aria-label="选择书友模式">
                <button
                  className={mode === "general_companion" ? "active" : ""}
                  onClick={() => switchMode("general_companion")}
                  type="button"
                >广泛书友</button>
                <button
                  className={mode === "book_room" ? "active" : ""}
                  onClick={() => switchMode("book_room")}
                  type="button"
                >本书房间</button>
              </div>
              <button
                aria-expanded={showRecommendations}
                className="next-book-button"
                onClick={() => setShowRecommendations(true)}
                type="button"
              >下一本</button>
            </div>
          </div>

          <div className={`conversation-stream ${messages.length <= 1 ? "conversation-welcome" : ""}`} aria-live="polite" ref={conversationStreamRef}>
            {messages.map((message) => (
              <article className={`message message-${message.role}`} key={message.id}>
                <div className="message-meta">
                  <span>{message.role === "companion" ? "泊舟" : readerProfile.display_name || "你"}</span>
                  {message.move && <em>{message.move}</em>}
                </div>
                <MarkdownMessage content={message.text} />
                {message.systemNote && <p className="system-note">{message.systemNote}</p>}
                {message.errorAction && (
                  <button
                    className="message-recovery-action"
                    onClick={() => {
                      if (message.errorAction === "settings") setShowPreferences(true);
                      else void sendMessage(message.retryText ?? "");
                    }}
                    type="button"
                  >
                    {message.errorAction === "settings" ? "检查书友模型" : "重新发送"}
                  </button>
                )}
                {message.role === "companion" && message.memoryId && message.memoryText && (
                  <div className="memory-candidate">
                    <span>是否记住：{message.memoryText}</span>
                    <button onClick={() => confirmMemory({
                      id: message.memoryId!, conversation_id: conversationId ?? "", scope: mode === "book_room" ? "book" : "global", book_title: activeBookTitle, content: message.memoryText!, status: "pending", created_at: "",
                    })} type="button">记住</button>
                    <button onClick={() => removeMemory({
                      id: message.memoryId!, conversation_id: conversationId ?? "", scope: mode === "book_room" ? "book" : "global", book_title: activeBookTitle, content: message.memoryText!, status: "pending", created_at: "",
                    })} type="button">先不记</button>
                  </div>
                )}
                {message.role === "companion" && message.id !== "welcome" && (
                  <div className="message-feedback">
                    {(Object.keys(feedbackLabels) as MessageFeedback[]).map((feedback) => (
                      <button
                        aria-pressed={feedbackByMessage[message.id] === feedback}
                        className={feedbackByMessage[message.id] === feedback ? "active" : ""}
                        key={feedback}
                        onClick={() => recordFeedback(message.id, feedback)}
                        type="button"
                      >
                        {feedbackLabels[feedback]}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            ))}
            {pending && (
              <div className="thinking"><i /><i /><i /><span>泊舟正在想怎样接住这句话</span></div>
            )}
          </div>

          <div className="composer-wrap">
            <form className="composer" onSubmit={submitMessage}>
              <div className="composer-context">
                <div className="composer-room"><span>{mode === "book_room" ? "当前书房" : "全局书友"}</span><strong>{mode === "book_room" ? `《${activeBookTitle}》` : "不绑定书籍"}</strong></div>
                <button className="composer-context-action" onClick={() => mode === "book_room" ? setShowLocalSetup(true) : setShowImportCenter(true)} type="button">{mode === "book_room" ? "切换书房" : "选择一本书"}</button>
              </div>
              <textarea
                aria-label="说说你读完后的想法"
                maxLength={4000}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder={mode === "book_room" ? "不必整理好。说说那句还留在心里的话……" : "从一个困惑、判断，或最近挥之不去的念头开始……"}
                ref={composerRef}
                rows={1}
                value={input}
              />
              <div className="composer-footer">
                <div className="composer-tools">
                  <div className="direction-tabs" aria-label="选择谈话方向">
                    {directionOptions.map((option) => (
                      <button
                        className={direction === option.id ? "active" : ""}
                        key={option.id}
                        onClick={() => setDirection(option.id)}
                        type="button"
                        title={option.note}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <label className="chat-model-selector">
                    <span>模型</span>
                    <select aria-label="选择本轮聊天模型" onChange={(event) => setSelectedModelProfileId(event.target.value || null)} value={selectedModelProfileId ?? ""}>
                      <option value="">{modelSettings.model ? modelNameForDisplay(modelSettings.model) : "暂未选择模型"}</option>
                      {modelProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profileNameForDisplay(profile)}{profile.is_default ? "（默认）" : ""}</option>)}
                    </select>
                    <button onClick={() => setShowPreferences(true)} type="button">管理</button>
                  </label>
                </div>
                <button disabled={!input.trim() || pending} type="submit">
                  {pending ? "正在回应" : "交给泊舟"}<b>↗</b>
                </button>
              </div>
            </form>
            {composerNotice && <p className="composer-notice" aria-live="polite">{composerNotice}</p>}
          </div>
        </section>

        <aside className={`recommendation-panel ${showRecommendations ? "is-open" : ""}`}>
          <button aria-label="关闭下一本书单" className="recommendation-close" onClick={() => setShowRecommendations(false)} type="button">收起</button>
          <p className="overline">懂你之后的下一本</p>
          <h2>不是榜单，<br />是三种邀请。</h2>
          <p className="recommendation-intro">
            根据你对真实、孤独和道德选择的关注，各选一本。
          </p>

          <div className="recommendation-list">
            {displayedRecommendations.map((item, index) => (
              <article className="recommendation-card" key={item.book.id}>
                <div className="recommendation-index">0{index + 1}</div>
                <div className={`lane lane-${item.lane}`}>{laneLabels[item.lane]}</div>
                <h3>{item.book.title}</h3>
                <p className="author">{item.book.author}</p>
                <p className="why">{item.why}</p>
                <details>
                  <summary>为什么可能不适合</summary>
                  <p>{item.book.caution}</p>
                </details>
                <button onClick={() => startRecommendationConversation(item)} type="button">
                  带着一个问题进入 <span>↗</span>
                </button>
              </article>
            ))}
          </div>

          <button className="different-button" onClick={changeRecommendationDirection} type="button">
            {showAlternativeRecommendations ? "回到原来的三种邀请" : "给我完全不同的东西"}
          </button>
          <p className="commercial-note">推荐排序不读取价格或佣金。</p>
        </aside>
      </section>
    </main>
  );
}

function flowMoveLabel(move: string): string {
  const labels: Record<string, string> = {
    listen: "倾听",
    mirror: "映照",
    tension: "形成张力",
    connect: "连接生活",
  };
  return labels[move] ?? "共同思考";
}

function searchDecisionNote(action?: string): string | undefined {
  const notes: Record<string, string> = {
    disabled: "这轮涉及动态信息，但你已关闭联网；泊舟不会绕过设置搜索。",
    permission_required: "联网会提高准确性；当前是“先问我”，演示版没有执行搜索。",
    would_search: "这轮会路由到已配置的搜索或数据 Skill；演示版只展示决策，不执行外部调用。",
  };
  return action ? notes[action] : undefined;
}

function memoryScopeLabel(scope: MemoryScope): string {
  const labels: Record<MemoryScope, string> = {
    global: "跨书线索",
    book: "本书线索",
    session: "仅此会话",
  };
  return labels[scope];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
