"use client";

import { DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { legacyMoveKeys, optionKeys, translate, type TranslationValues, type UiCopyKey, type UiLanguage } from "./i18n";

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

function translateLabelMap<T extends string>(language: UiLanguage, keys: Record<T, UiCopyKey>): Record<T, string> {
  return Object.fromEntries(
    (Object.entries(keys) as Array<[T, UiCopyKey]>).map(([key, translationKey]) => [key, translate(language, translationKey)]),
  ) as Record<T, string>;
}

function formatBookTitle(title: string, language: UiLanguage) {
  return language === "zh" ? `《${title}》` : title;
}

function modelNameForDisplay(model: string, language: UiLanguage = "zh") {
  const value = model.trim();
  if (!value) return translate(language, "system.unnamedModel");
  if (value.toLowerCase() === "deepseek-chat") return "DeepSeek Chat";

  const qwenMatch = value.match(/^qwen([\d.]+):(\d+)b(?:-(.+))?$/i);
  if (qwenMatch) {
    return `Qwen ${qwenMatch[1]} ${qwenMatch[2]}B${qwenMatch[3] ? ` ${qwenMatch[3].replace(/-/g, " ")}` : ""}`;
  }

  return value;
}

function profileNameForDisplay(profile: ModelProfile, language: UiLanguage = "zh") {
  const name = profile.name.trim();
  // Old profiles often used an IP address as a name; keep infrastructure out of chat UI.
  if (!name || /https?:\/\/|(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?/.test(name)) {
    return modelNameForDisplay(profile.model, language);
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

async function chatErrorFromResponse(response: Response, language: UiLanguage): Promise<ChatResponseError> {
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
    return new ChatResponseError(translate(language, "system.modelAuthenticationFailed"), "settings");
  }
  if (response.status === 408 || response.status === 504 || hasDetail(["timeout", "timed out"])) {
    return new ChatResponseError(translate(language, "system.modelTimedOut"), "retry");
  }
  if (hasDetail(["connecterror", "connection", "network is unreachable", "connection refused"])) {
    return new ChatResponseError(translate(language, "system.modelUnavailable"), "settings");
  }
  if (response.status === 422) {
    return new ChatResponseError(translate(language, "system.messageCannotSend"), "retry");
  }
  if (response.status >= 500) {
    return new ChatResponseError(translate(language, "system.responseInterrupted"), "retry");
  }
  return new ChatResponseError(translate(language, "system.responseIncomplete"), "retry");
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

const englishRecommendationCopies: Record<string, Omit<Recommendation, "lane">> = {
  siddhartha: {
    why: "Continue your questions about truth and solitude through one person's lived journey.",
    book: { id: "siddhartha", title: "Siddhartha", author: "Hermann Hesse", caution: "Its argument is poetic and allegorical rather than systematic philosophy.", entry_question: "Are some forms of understanding only lived, never taught?" },
  },
  "notes-from-underground": {
    why: "Push fidelity to oneself into an uncomfortable place, where honesty may also become a trap.",
    book: { id: "notes-from-underground", title: "Notes from Underground", author: "Fyodor Dostoevsky", caution: "The narrator is deliberately bitter and contradictory; the discomfort is part of the book.", entry_question: "Does refusing every explanation make a person freer?" },
  },
  "mans-search-for-meaning": {
    why: "Move from literature into psychology and ethics while staying with choice, responsibility, and meaning.",
    book: { id: "mans-search-for-meaning", title: "Man's Search for Meaning", author: "Viktor Frankl", caution: "It addresses the Holocaust and profound suffering; it should not be reduced to self-help.", entry_question: "Is meaning discovered, or created through how we answer a situation?" },
  },
  "the-summer-book": {
    why: "Step back from argument and notice how people seek closeness while protecting their own boundaries.",
    book: { id: "the-summer-book", title: "The Summer Book", author: "Tove Jansson", caution: "It is brief and spacious, suited to slow reading rather than plot-driven momentum.", entry_question: "When is silence companionship, and when is it avoidance?" },
  },
  "the-dispossessed": {
    why: "Move freedom from private choice into shared institutions and watch ideals change inside real relationships.",
    book: { id: "the-dispossessed", title: "The Dispossessed", author: "Ursula K. Le Guin", caution: "Its political questions arrive through substantial science-fiction world-building.", entry_question: "If everyone seeks freedom, who carries the responsibilities no one can avoid?" },
  },
  "braiding-sweetgrass": {
    why: "Take a nonfiction path through land, knowledge, and reciprocity to reconsider what meaning asks of us.",
    book: { id: "braiding-sweetgrass", title: "Braiding Sweetgrass", author: "Robin Wall Kimmerer", caution: "It comes from specific Indigenous knowledge traditions and should not be flattened into universal inspiration.", entry_question: "When we say we own something, do we also change how we relate to it?" },
  },
};

function recommendationForLanguage(recommendation: Recommendation, language: UiLanguage): Recommendation {
  if (language === "zh") return recommendation;
  const english = englishRecommendationCopies[recommendation.book.id];
  return english ? { lane: recommendation.lane, ...english } : recommendation;
}

export default function Home() {
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>("zh");
  const uiLanguageRef = useRef<UiLanguage>("zh");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "companion",
      text: translate("zh", optionKeys.welcome.book_room),
      move: translate("zh", "ui.invitation"),
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
  const [setupStatus, setSetupStatus] = useState(() => translate("zh", "ui.preparingYourModelList"));
  const [setupLoaded, setSetupLoaded] = useState(false);
  const [setupPending, setSetupPending] = useState(false);
  const [showRelationship, setShowRelationship] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [memories, setMemories] = useState<LocalMemory[]>([]);
  const [relationshipStatus, setRelationshipStatus] = useState(() => translate("zh", "ui.onlyMemoriesYouConfirmWillBe"));
  const [activeBookId, setActiveBookId] = useState<string | null>("the-stranger");
  const [activeBookTitle, setActiveBookTitle] = useState(() => translate("zh", "ui.theStranger"));
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const conversationStreamRef = useRef<HTMLDivElement>(null);

  const t = (key: UiCopyKey, values?: TranslationValues) => translate(uiLanguage, key, values);
  const directionOptions = (Object.entries(optionKeys.direction) as Array<[Direction, typeof optionKeys.direction[Direction]]>).map(([id, keys]) => ({
    id,
    label: t(keys.label),
    note: t(keys.note),
  }));
  const laneLabels = translateLabelMap(uiLanguage, optionKeys.lane);
  const searchPolicyLabels = translateLabelMap(uiLanguage, optionKeys.searchPolicy);
  const readingStatusLabels = translateLabelMap(uiLanguage, optionKeys.readingStatus);
  const spoilerPolicyLabels = translateLabelMap(uiLanguage, optionKeys.spoilerPolicy);
  const companionStanceLabels = translateLabelMap(uiLanguage, optionKeys.companionStance);
  const readingNoteKindLabels = translateLabelMap(uiLanguage, optionKeys.readingNoteKind);
  const feedbackLabels = translateLabelMap(uiLanguage, optionKeys.feedback);

  const activeDirection = useMemo(
    () => directionOptions.find((option) => option.id === direction)!,
    [direction, uiLanguage],
  );
  const activeDocument = useMemo(
    () => documents.find((document) => document.id === selectedDocumentId) ?? null,
    [documents, selectedDocumentId],
  );
  const selectedLibraryBook = useMemo(
    () => libraryBooks.find((book) => book.id === selectedLibraryBookId) ?? null,
    [libraryBooks, selectedLibraryBookId],
  );
  const displayedRecommendations = (showAlternativeRecommendations
    ? alternativeRecommendations
    : recommendations).map((recommendation) => recommendationForLanguage(recommendation, uiLanguage));
  const activeBookDisplayTitle = activeBookId === "the-stranger"
    ? t("ui.theStranger")
    : activeBookTitle;
  const visibleImportDocuments = useMemo(() => documents.filter((document) => (
    documentFilter === "all"
      || (documentFilter === "unfiled" ? !document.book_id : Boolean(document.book_id))
  )), [documents, documentFilter]);

  function focusComposer() {
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function changeUiLanguage(language: UiLanguage) {
    uiLanguageRef.current = language;
    setUiLanguage(language);
    window.localStorage.setItem("bookmate-ui-language", language);
  }

  useEffect(() => {
    const saved = window.localStorage.getItem("bookmate-ui-language");
    const language = saved === "zh" || saved === "en"
      ? saved
      : window.navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
    uiLanguageRef.current = language;
    setUiLanguage(language);
  }, []);

  useEffect(() => {
    document.documentElement.lang = uiLanguage === "zh" ? "zh-CN" : "en";
    document.title = t("ui.bookmateYourPrivateAiBookFriend");
    setSetupStatus(setupLoaded
      ? (modelSettings.base_url && modelSettings.model
        ? t("ui.isReady", { value0: modelNameForDisplay(modelSettings.model, uiLanguage) })
        : t("ui.noModelIsAvailableYetAdd"))
      : t("ui.preparingYourModelList"));
    setRelationshipStatus(t("ui.onlyMemoriesYouConfirmWillBe"));
    setMessages((current) => {
      if (conversationId || current.length !== 1 || current[0].role !== "companion") return current;
      const roomWelcome = mode === "book_room" && activeBookId !== "the-stranger"
        ? t(optionKeys.welcome.namedBookRoom, { value0: activeBookTitle })
        : t(optionKeys.welcome[mode]);
      return [{ ...current[0], text: roomWelcome, move: t("ui.invitation") }];
    });
  }, [uiLanguage]);

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
    setComposerNotice(t("ui.aStartingQuestionFromIsReady", { value0: item.book.title }));
    focusComposer();
  }

  function changeRecommendationDirection() {
    setShowAlternativeRecommendations((current) => !current);
    setComposerNotice(showAlternativeRecommendations
      ? t("ui.backToTheOriginalThreeReading")
      : t("ui.hereIsADifferentSetOf"),
    );
  }

  function recordFeedback(messageId: string, feedback: MessageFeedback) {
    setFeedbackByMessage((current) => ({ ...current, [messageId]: feedback }));
    setComposerNotice(t("ui.notedThisAdjustsTheCurrentConversation", { value0: feedbackLabels[feedback] }));
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
        setActiveBookTitle(translate(uiLanguageRef.current, "ui.theStranger"));
      }
    }
    setMessages([
      {
        id: `welcome-${nextMode}`,
        role: "companion",
        text: nextMode === "book_room" && localTitle
          ? t("ui.noNeedToBeginBySummarizing", { value0: localTitle })
          : t(optionKeys.welcome[nextMode]),
        move: t("ui.invitation"),
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
        const responseLanguage = uiLanguageRef.current;
        setMessages((current) => current.length === 1 && current[0].id === "welcome"
          ? [{
            id: "welcome",
            role: "companion",
            text: responseLanguage === "zh" ? session.greeting : translate(responseLanguage, optionKeys.welcome.book_room),
            move: translate(responseLanguage, "ui.invitation"),
          }]
          : current);
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
    setSetupStatus(t("ui.addingThisBookToYourPrivate"));
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
      setSetupStatus(t("ui.isNowInYourLibraryAdd", { value0: book.title }));
    } catch (error) {
      setSetupStatus(t("ui.couldNotAddTheBook", { value0: error instanceof Error ? error.message : t("system.unknownError") }));
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
      setSetupStatus(t("ui.roomPreferencesForHaveBeenSaved", { value0: updated.title }));
    } catch (error) {
      setSetupStatus(t("ui.couldNotSaveRoomPreferences", { value0: error instanceof Error ? error.message : t("system.unknownError") }));
    } finally {
      setSetupPending(false);
    }
  }

  async function captureReadingNote(event: FormEvent<HTMLFormElement>, targetBookId = selectedLibraryBookId) {
    event.preventDefault();
    if (!targetBookId) {
      setSetupStatus(t("ui.chooseABookBeforeSavingThis"));
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
      setSetupStatus(t("ui.thisReadingTraceIsSavedTo", { value0: targetBook?.title ?? t("system.selectedBook") }));
    } catch (error) {
      setSetupStatus(t("ui.couldNotSaveTheReadingTrace", { value0: error instanceof Error ? error.message : t("system.unknownError") }));
    } finally {
      setSetupPending(false);
    }
  }

  async function removeReadingNote(note: ReadingNote) {
    if (!selectedLibraryBook) return;
    if (!window.confirm(t("ui.deleteThisQuoteOrReflectionIt"))) return;
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
      setSetupStatus(t("ui.theLocalReadingTraceHasBeen"));
    } catch {
      setSetupStatus(t("ui.couldNotDeleteTheReadingTrace"));
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
      setSetupStatus(t("ui.couldNotUpdateReadingStatusPlease"));
    }
  }

  async function removeLibraryBook(book: LibraryBook) {
    if (!window.confirm(t("ui.removeFromTheLibraryAttachedFiles", { value0: book.title }))) return;
    try {
      const response = await fetch(`${API_BASE}/v1/library/books/${book.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Book unavailable");
      if (selectedLibraryBookId === book.id) {
        setSelectedLibraryBookId(null);
        setSelectedDocumentId(null);
        setReadingNotes([]);
        setActiveBookId("the-stranger");
        setActiveBookTitle(t("ui.theStranger"));
      }
      await refreshLibraryData();
      setSetupStatus(t("ui.wasRemovedFromTheLibraryOriginal", { value0: book.title }));
    } catch {
      setSetupStatus(t("ui.couldNotRemoveTheBookPlease"));
    }
  }

  async function continueConversation(summary: ConversationSummary) {
    try {
      const response = await fetch(`${API_BASE}/v1/conversations/${summary.id}`);
      if (!response.ok) throw new Error("Conversation unavailable");
      const detail: { messages: StoredMessage[] } = await response.json();
      setConversationId(summary.id);
      setMode(summary.mode);
      setActiveBookTitle(summary.book_title ?? t("ui.theStranger"));
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
      setRelationshipStatus(t("ui.theLocalConversationHasBeenRestored"));
    } catch {
      setRelationshipStatus(t("ui.couldNotRestoreTheConversationIts"));
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
          ? { ...message, memoryId: undefined, systemNote: `${message.systemNote ?? ""} ${t("ui.savedAsConfirmedLocalMemory")}`.trim() }
          : message
      )));
      setRelationshipStatus(t("ui.confirmedThisMemoryCanInformFuture"));
    } catch {
      setRelationshipStatus(t("ui.couldNotSaveTheMemoryPlease"));
    }
  }

  async function removeMemory(memory: LocalMemory) {
    if (!window.confirm(t("ui.deleteThisLocalMemoryItWill"))) return;
    try {
      const response = await fetch(`${API_BASE}/v1/memories/${memory.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Memory unavailable");
      await refreshRelationshipData();
      setMessages((current) => current.map((message) => (
        message.memoryId === memory.id
          ? { ...message, memoryId: undefined, systemNote: `${message.systemNote ?? ""} ${t("ui.thisCandidateWasNotSaved")}`.trim() }
          : message
      )));
      setRelationshipStatus(t("ui.theLocalMemoryHasBeenDeleted"));
    } catch {
      setRelationshipStatus(t("ui.couldNotDeleteTheMemoryPlease"));
    }
  }

  async function deleteConversation(summary: ConversationSummary) {
    if (!window.confirm(t("ui.deleteItsMessagesAndRelatedMemories", { value0: summary.title }))) return;
    try {
      const response = await fetch(`${API_BASE}/v1/conversations/${summary.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Conversation unavailable");
      if (conversationId === summary.id) {
        setConversationId(null);
        switchMode(mode);
      }
      await refreshRelationshipData();
      setRelationshipStatus(t("ui.theLocalConversationAndItsRelated"));
    } catch {
      setRelationshipStatus(t("ui.couldNotDeleteTheConversationPlease"));
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
      setRelationshipStatus(t("ui.conversationsMemoriesAndLibraryMetadataHave"));
    } catch {
      setRelationshipStatus(t("ui.exportFailedMakeSureTheLocal"));
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
        setSetupLoaded(true);
        const responseLanguage = uiLanguageRef.current;
        setSetupStatus(
          settings.base_url && settings.model
            ? translate(responseLanguage, "ui.isReady", { value0: modelNameForDisplay(settings.model, responseLanguage) })
            : translate(responseLanguage, "ui.noModelIsAvailableYetAdd"),
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
      setSetupStatus(t("ui.couldNotLoadTheModelList"));
    }
  }

  async function saveReaderProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSetupPending(true);
    setSetupStatus(t("ui.savingInterfacePreferences"));
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
      setSetupStatus(profile.display_name
        ? t("ui.yourInterfaceNameIsNow", { value0: profile.display_name })
        : t("ui.theDefaultInterfaceNameHasBeen"));
    } catch (error) {
      setSetupStatus(t("ui.couldNotSaveYourPreferences", { value0: error instanceof Error ? error.message : t("system.unknownError") }));
    } finally {
      setSetupPending(false);
    }
  }

  async function saveModelProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSetupPending(true);
    setSetupStatus(t("ui.savingModel"));
    try {
      const editingProfile = modelProfiles.find((profile) => profile.id === editingModelProfileId) ?? null;
      const payload: Record<string, string | number | boolean | null> = {
        name: modelProfileName.trim() || modelNameForDisplay(modelDraft.model, uiLanguage),
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
      setSetupStatus(t("ui.hasBeenSavedAndSelectedFor", { value0: profileNameForDisplay(profile, uiLanguage) }));
    } catch (error) {
      setSetupStatus(t("ui.saveFailed", { value0: error instanceof Error ? error.message : t("system.unknownError") }));
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
    setSetupStatus(t("ui.editingLeaveTheApiKeyBlank", { value0: profileNameForDisplay(profile, uiLanguage) }));
  }

  function cancelModelProfileEdit() {
    setEditingModelProfileId(null);
    setModelProfileName("");
    setApiKey("");
    setModelDraft(emptyModelSettings());
  }

  async function testModelProfile(profile: ModelProfile) {
    setSetupPending(true);
    setSetupStatus(t("ui.testing", { value0: profileNameForDisplay(profile, uiLanguage) }));
    try {
      const response = await fetch(`${API_BASE}/v1/settings/models/${profile.id}/test`, { method: "POST" });
      const result = await response.json();
      setSetupStatus(
        result.ok
          ? t("ui.isReadyMs", { value0: profileNameForDisplay(profile, uiLanguage), value1: result.latency_ms })
          : t("ui.unavailable", { value0: result.message }),
      );
    } catch (error) {
      setSetupStatus(t("ui.connectionFailed", { value0: error instanceof Error ? error.message : t("system.unknownError") }));
    } finally {
      setSetupPending(false);
    }
  }

  async function testEnvironmentModel() {
    setSetupPending(true);
    setSetupStatus(t("ui.testing", { value0: modelNameForDisplay(modelSettings.model, uiLanguage) }));
    try {
      const response = await fetch(`${API_BASE}/v1/settings/model/test`, { method: "POST" });
      const result = await response.json();
      setSetupStatus(
        result.ok
          ? t("ui.isReadyMs", { value0: modelNameForDisplay(result.model, uiLanguage), value1: result.latency_ms })
          : t("ui.unavailable", { value0: result.message || t("system.modelServiceUnreadable") }),
      );
    } catch (error) {
      setSetupStatus(t("ui.modelTestFailed", { value0: error instanceof Error ? error.message : t("system.unknownError") }));
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
      setSetupStatus(t("ui.isNowTheDefaultForNew", { value0: profileNameForDisplay(profile, uiLanguage) }));
    } catch (error) {
      setSetupStatus(t("ui.couldNotUpdateTheDefaultModel", { value0: error instanceof Error ? error.message : t("system.unknownError") }));
    } finally {
      setSetupPending(false);
    }
  }

  async function removeModelProfile(profile: ModelProfile) {
    if (!window.confirm(t("ui.removeThisWillNotChangeThe", { value0: profileNameForDisplay(profile, uiLanguage) }))) return;
    setSetupPending(true);
    try {
      const response = await fetch(`${API_BASE}/v1/settings/models/${profile.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await response.text());
      await refreshModelProfiles();
      setSetupStatus(t("ui.hasBeenRemoved", { value0: profileNameForDisplay(profile, uiLanguage) }));
    } catch (error) {
      setSetupStatus(t("ui.couldNotRemoveTheModelProfile", { value0: error instanceof Error ? error.message : t("system.unknownError") }));
    } finally {
      setSetupPending(false);
    }
  }

  async function uploadDocument(file: File | undefined, targetBookId = selectedLibraryBookId) {
    if (!file) return;
    setSetupPending(true);
    setSetupStatus(t("ui.parsingLocally", { value0: file.name }));
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
      setSetupStatus(t("ui.wasParsedLocallyIntoTextChunks", { value0: document.name, value1: document.chunk_count }));
    } catch (error) {
      setSetupStatus(t("ui.importFailed", { value0: error instanceof Error ? error.message : t("system.unknownError") }));
    } finally {
      setSetupPending(false);
    }
  }

  async function removeDocument(document: KnowledgeDocument) {
    if (!window.confirm(t("ui.deleteAndItsLocalIndexYour", { value0: document.name }))) return;
    const response = await fetch(`${API_BASE}/v1/knowledge/documents/${document.id}`, { method: "DELETE" });
    if (!response.ok) {
      setSetupStatus(t("ui.deleteFailedPleaseTryAgain"));
      return;
    }
    setDocuments((current) => current.filter((item) => item.id !== document.id));
    if (selectedDocumentId === document.id) setSelectedDocumentId(null);
    // The shelf item remains the active conversation context even if one version is removed.
    if (document.book_id) refreshLibraryData();
    setSetupStatus(t("ui.theBookmateCopyAndLocalIndex", { value0: document.name }));
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
        ? t("ui.isNowAttachedTo", { value0: updated.name, value1: owner.title })
        : t("ui.hasBeenMovedBackToUnfiled", { value0: updated.name }));
    } catch (error) {
      setSetupStatus(t("ui.couldNotChangeTheFileAssignment", { value0: error instanceof Error ? error.message : t("system.unknownError") }));
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
      if (!response.ok) throw await chatErrorFromResponse(response, uiLanguage);
      const data = await response.json();
      if (data.conversation_id) setConversationId(data.conversation_id);
      const notes = [
        data.citations?.length ? t("ui.thisResponseUsedLocalSourcesOr", { value0: data.citations.length }) : undefined,
        searchDecisionNote(data.search_decision?.action, uiLanguage),
      ].filter(Boolean);
      setMessages((current) => [
        ...current,
        {
          id: `companion-${Date.now()}`,
          role: "companion",
          text: `${data.reply}\n\n${data.follow_up}`,
          move: flowMoveLabel(data.flow_move, uiLanguage),
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
            ? t("ui.bookmateDidNotReceiveAComplete")
            : t("ui.bookmateIsNotReachableMakeSure"),
          "retry",
        );
      setApiOnline(receivedResponse);
      setMessages((current) => [
        ...current,
        {
          id: `chat-error-${Date.now()}`,
          role: "companion",
          text: chatError.message,
          move: t("ui.tryAgain"),
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
    <main className={`page-shell language-${uiLanguage}`}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar reveal reveal-one">
        <div className="brand-lockup">
          <span className="brand-mark">{t("ui.b")}</span>
          <div>
            <p className="brand-name">{t("ui.bookmate")}</p>
            <p className="brand-subtitle">{t("ui.yourPrivateAiBookFriend")}</p>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="language-switch" aria-label={t("ui.interfaceLanguage")}>
            <button aria-pressed={uiLanguage === "zh"} className={uiLanguage === "zh" ? "active" : ""} onClick={() => changeUiLanguage("zh")} type="button">{t("system.languageChineseShort")}</button>
            <button aria-pressed={uiLanguage === "en"} className={uiLanguage === "en" ? "active" : ""} onClick={() => changeUiLanguage("en")} type="button">{t("system.languageEnglishShort")}</button>
          </div>
          <label className="search-policy">
            <span>{t("ui.web")}</span>
            <select
              aria-label={t("ui.webSearchPolicy")}
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
            {apiOnline === null ? t("ui.starting") : apiOnline ? t("ui.bookmateIsReady") : t("ui.offlinePreview")}
          </span>
        </div>
      </header>

      {showRelationship && (
        <div className="setup-backdrop" role="presentation" onMouseDown={() => setShowRelationship(false)}>
          <section
            aria-label={t("ui.localConversationsAndMemories")}
            aria-modal="true"
            className="relationship-drawer"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="setup-heading">
              <div>
                <p className="overline">{t("ui.continuityNotSurveillance")}</p>
                <h2>{t("ui.whatWeRemember")}</h2>
              </div>
              <button aria-label={t("ui.closeConversationsAndMemories")} onClick={() => setShowRelationship(false)} type="button">×</button>
            </div>
            <p className="privacy-callout">
              {t("ui.conversationsStayOnThisComputerOnly")}
            </p>

            <div className="relationship-section">
              <div className="setup-section-title">
                <span>01</span><div><h3>{t("ui.continueAConversation")}</h3><p>{t("ui.eachConversationCanBeDeletedSeparately")}</p></div>
              </div>
              <div className="conversation-list">
                {conversations.length === 0 && <p className="empty-library">{t("ui.noConversationsAreSavedYetYour")}</p>}
                {conversations.map((conversation) => (
                  <article className={conversation.id === conversationId ? "selected" : ""} key={conversation.id}>
                    <button className="conversation-select" onClick={() => continueConversation(conversation)} type="button">
                      <strong>{conversation.title}</strong>
                      <small>{conversation.book_title ?? t("ui.openConversation")} · {conversation.message_count} {t("ui.messages")}</small>
                    </button>
                    <button className="document-delete" onClick={() => deleteConversation(conversation)} type="button">{t("ui.delete")}</button>
                  </article>
                ))}
              </div>
            </div>

            <div className="relationship-section">
              <div className="setup-section-title">
                <span>02</span><div><h3>{t("ui.memoriesAwaitingYou")}</h3><p>{t("ui.onlyConfirmedMemoriesInformFutureConversations")}</p></div>
              </div>
              <div className="memory-list">
                {memories.filter((memory) => memory.status === "pending").length === 0 && <p className="empty-library">{t("ui.noMemoryCandidatesAreWaiting")}</p>}
                {memories.filter((memory) => memory.status === "pending").map((memory) => (
                  <article key={memory.id}>
                    <p>{memory.content}</p>
                    <div><span>{memoryScopeLabel(memory.scope, uiLanguage)}</span><button onClick={() => confirmMemory(memory)} type="button">{t("ui.confirm")}</button><button onClick={() => removeMemory(memory)} type="button">{t("ui.doNotSave")}</button></div>
                  </article>
                ))}
              </div>
            </div>

            <div className="relationship-section confirmed-memories">
              <div className="setup-section-title">
                <span>03</span><div><h3>{t("ui.confirmedThreads")}</h3><p>{t("ui.deleteThemOrBeginAgainAt")}</p></div>
              </div>
              <div className="memory-list">
                {memories.filter((memory) => memory.status === "confirmed").length === 0 && <p className="empty-library">{t("ui.thereAreNoLongTermThreads")}</p>}
                {memories.filter((memory) => memory.status === "confirmed").map((memory) => (
                  <article key={memory.id}>
                    <p>{memory.content}</p>
                    <div><span>{memoryScopeLabel(memory.scope, uiLanguage)}</span><button onClick={() => removeMemory(memory)} type="button">{t("ui.delete")}</button></div>
                  </article>
                ))}
              </div>
            </div>

            <div className="relationship-export">
              <button onClick={downloadExport} type="button">{t("ui.exportMyLocalData")}</button>
              <p>{t("ui.exportsConversationsMemoriesAndLibraryMetadata")}</p>
            </div>
            <p className="setup-status" aria-live="polite">{relationshipStatus}</p>
          </section>
        </div>
      )}

      {showImportCenter && (
        <div className="import-backdrop" role="presentation" onMouseDown={() => setShowImportCenter(false)}>
          <section
            aria-label={t("ui.importCenter")}
            aria-modal="true"
            className="import-workbench"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="import-heading">
              <div>
                <p className="overline">{t("ui.bringYourReadingIn")}</p>
                <h2>{t("ui.importCenter")}</h2>
                <p>{t("ui.firstDecideWhichBookThisBelongs")}</p>
              </div>
              <button aria-label={t("ui.closeImportCenter")} onClick={() => setShowImportCenter(false)} type="button">×</button>
            </header>

            <div className="import-stats" aria-label={t("ui.localContentOverview")}>
              <div><strong>{libraryBooks.length}</strong><span>{t("ui.bookRooms")}</span></div>
              <div><strong>{documents.length}</strong><span>{t("ui.localFiles")}</span></div>
              <div><strong>{documents.filter((document) => !document.book_id).length}</strong><span>{t("ui.unfiled")}</span></div>
            </div>

            <nav className="import-tabs" aria-label={t("ui.chooseAnImportMethod")}>
              <button className={importTab === "files" ? "active" : ""} onClick={() => setImportTab("files")} type="button">
                <span>01</span><strong>{t("ui.filesEditions")}</strong><small>EPUB, PDF, TXT, Markdown</small>
              </button>
              <button className={importTab === "notes" ? "active" : ""} onClick={() => setImportTab("notes")} type="button">
                <span>02</span><strong>{t("ui.readingTraces")}</strong><small>{t("ui.quotesReflectionsQuestions")}</small>
              </button>
              <button className={importTab === "books" ? "active" : ""} onClick={() => setImportTab("books")} type="button">
                <span>03</span><strong>{t("ui.createABookFirst")}</strong><small>{t("ui.noFileRequired")}</small>
              </button>
            </nav>

            {importTab === "files" && (
              <section className="import-stage">
                <div className="import-stage-heading">
                  <div><p className="overline">{t("ui.fileImport")}</p><h3>{t("ui.addAnEditionOrSourceTo")}</h3></div>
                  <label className="import-target"><span>{t("ui.bookRoom")}</span><select onChange={(event) => setImportTargetBookId(event.target.value || null)} value={importTargetBookId ?? ""}><option value="">{t("ui.leaveUnfiled")}</option>{libraryBooks.map((book) => <option key={book.id} value={book.id}>{formatBookTitle(book.title, uiLanguage)}</option>)}</select></label>
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
                  <strong>{t("ui.chooseAFileOrDropIt")}</strong>
                  <small>{t("ui.supportsEpubPdfTxtAndMarkdown")}</small>
                </label>
                <div className="import-list-heading"><div><h4>{t("ui.importedSources")}</h4><p>{t("ui.sourcesCanBeReassignedAtAny")}</p></div><div className="document-filter"><button className={documentFilter === "all" ? "active" : ""} onClick={() => setDocumentFilter("all")} type="button">{t("ui.all")} {documents.length}</button><button className={documentFilter === "unfiled" ? "active" : ""} onClick={() => setDocumentFilter("unfiled")} type="button">{t("ui.unfiled2")} {documents.filter((document) => !document.book_id).length}</button></div></div>
                <div className="import-document-list">
                  {visibleImportDocuments.length === 0 && <p className="empty-library">{t("ui.noMatchingSourcesAreHereYet")}</p>}
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
                        <span><strong>{document.name}</strong><small>{libraryBooks.find((book) => book.id === document.book_id)?.title ?? t("ui.unfiled2")} · {document.chunk_count} {t("ui.chunks")} · {formatBytes(document.size_bytes)}</small></span>
                      </button>
                      <select aria-label={t("ui.changeTheAssignmentFor", { value0: document.name })} className="document-assignment" disabled={setupPending} onChange={(event) => reassignDocument(document, event.target.value)} value={document.book_id ?? ""}><option value="">{t("ui.unfiled2")}</option>{libraryBooks.map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}</select>
                      <button className="document-delete" onClick={() => removeDocument(document)} type="button">{t("ui.delete")}</button>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {importTab === "notes" && (
              <section className="import-stage">
                <div className="import-stage-heading">
                  <div><p className="overline">{t("ui.readingCapture")}</p><h3>{t("ui.keepThePlaceThatMadeYou")}</h3></div>
                  <label className="import-target"><span>{t("ui.saveTo")}</span><select disabled={libraryBooks.length === 0} onChange={(event) => setImportTargetBookId(event.target.value || null)} value={importTargetBookId ?? ""}><option value="">{t("ui.chooseABook")}</option>{libraryBooks.map((book) => <option key={book.id} value={book.id}>{formatBookTitle(book.title, uiLanguage)}</option>)}</select></label>
                </div>
                {libraryBooks.length === 0 ? <p className="empty-library">{t("ui.aReadingTraceNeedsABook")}</p> : (
                  <form className="import-note-form" onSubmit={(event) => captureReadingNote(event, importTargetBookId)}>
                    <label><span>{t("ui.type")}</span><select defaultValue="reflection" name="kind">{(Object.keys(readingNoteKindLabels) as ReadingNoteKind[]).map((kind) => <option key={kind} value={kind}>{readingNoteKindLabels[kind]}</option>)}</select></label>
                    <label><span>{t("ui.location")}</span><input name="locator" placeholder={t("ui.optionalChapterPageOrProgress")} /></label>
                    <label className="import-note-wide"><span>{t("ui.quoteOrHighlight")}</span><textarea name="quote" placeholder={t("ui.optionalYourOwnWordsAreEnough")} /></label>
                    <label className="import-note-wide"><span>{t("ui.yourThought")}</span><textarea name="content" placeholder={t("ui.writeTheJudgmentFeelingOrQuestion")} required /></label>
                    <button disabled={setupPending || !importTargetBookId} type="submit">{t("ui.saveToBookRoom")}</button>
                  </form>
                )}
              </section>
            )}

            {importTab === "books" && (
              <section className="import-stage">
                <div className="import-stage-heading"><div><p className="overline">{t("ui.aRoomBeforeAFile")}</p><h3>{t("ui.makeRoomForABookFirst")}</h3><p>{t("ui.aPrintBookATitleIn")}</p></div></div>
                <form className="import-book-form" onSubmit={createLibraryBook}>
                  <label><span>{t("ui.title")}</span><input onChange={(event) => setNewBookTitle(event.target.value)} placeholder={t("ui.forExampleTheStranger")} value={newBookTitle} /></label>
                  <label><span>{t("ui.author")}</span><input onChange={(event) => setNewBookAuthor(event.target.value)} placeholder={t("ui.optional")} value={newBookAuthor} /></label>
                  <label><span>{t("ui.readingStatus")}</span><select onChange={(event) => setNewBookStatus(event.target.value as ReadingStatus)} value={newBookStatus}>{(Object.keys(readingStatusLabels) as ReadingStatus[]).map((status) => <option key={status} value={status}>{readingStatusLabels[status]}</option>)}</select></label>
                  <button disabled={setupPending || !newBookTitle.trim()} type="submit">{t("ui.createBookRoom")}</button>
                </form>
                <p className="import-assurance">{t("ui.creatingARoomNeverRequiresA")}</p>
              </section>
            )}

            <p className="import-status" aria-live="polite">{setupStatus}</p>
          </section>
        </div>
      )}

      {showPreferences && (
        <div className="setup-backdrop" role="presentation" onMouseDown={() => setShowPreferences(false)}>
          <section
            aria-label={t("ui.preferencesAndModels")}
            aria-modal="true"
            className="preferences-drawer"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="setup-heading">
              <div>
                <p className="overline">{t("ui.yourSpaceYourChoice")}</p>
                <h2>{t("ui.preferencesModels")}</h2>
              </div>
              <button aria-label={t("ui.closePreferencesAndModels")} onClick={() => setShowPreferences(false)} type="button">×</button>
            </div>

            <p className="privacy-callout">
              {t("ui.theseArePersonalPreferencesSeparateFrom")}
            </p>

            <form className="reader-profile-form" onSubmit={saveReaderProfile}>
              <div className="setup-section-title">
                <span>01</span><div><h3>{t("ui.yourName")}</h3><p>{t("ui.itIsShownOnlyInThe")}</p></div>
              </div>
              <label>
                <span>{t("ui.displayName")}</span>
                <input
                  maxLength={80}
                  onChange={(event) => setReaderDisplayName(event.target.value)}
                  placeholder={t("ui.forExampleLin")}
                  value={readerDisplayName}
                />
              </label>
              <div className="setup-actions">
                <button className="model-save" disabled={setupPending} type="submit">{t("ui.save")}</button>
              </div>
            </form>

            <div className="model-profile-manager">
              <div className="setup-section-title">
                <span>02</span><div><h3>{t("ui.bookFriendModels")}</h3><p>{t("ui.chooseTheModelForThisConversation")}</p></div>
              </div>
              <div className="model-profile-list">
                {modelSettings.model && (
                  <article className={!selectedModelProfileId ? "selected" : ""}>
                    <button className="model-profile-select" onClick={() => setSelectedModelProfileId(null)} type="button">
                      <span className="model-profile-mark">AI</span>
                      <span>
                        <strong>{modelNameForDisplay(modelSettings.model, uiLanguage)}</strong>
                        <small>{t("ui.readyToUse")}</small>
                      </span>
                    </button>
                    <div className="model-profile-actions">
                      {!selectedModelProfileId && <span>{t("ui.inUse")}</span>}
                      <button disabled={setupPending || !modelSettings.base_url} onClick={testEnvironmentModel} type="button">{t("ui.test")}</button>
                    </div>
                  </article>
                )}
                {!modelSettings.model && modelProfiles.length === 0 && <p className="empty-library">{t("ui.noModelIsAvailableYetAdd2")}</p>}
                {modelProfiles.map((profile) => (
                  <article className={selectedModelProfileId === profile.id ? "selected" : ""} key={profile.id}>
                    <button className="model-profile-select" onClick={() => setSelectedModelProfileId(profile.id)} type="button">
                      <span className="model-profile-mark">AI</span>
                      <span>
                        <strong>{profileNameForDisplay(profile, uiLanguage)}</strong>
                        <small>{profile.is_default ? t("ui.defaultForNewConversations") : t("ui.availableForThisConversation")}</small>
                      </span>
                    </button>
                    <div className="model-profile-actions">
                      <button disabled={setupPending} onClick={() => beginModelProfileEdit(profile)} type="button">{t("ui.edit")}</button>
                      {selectedModelProfileId === profile.id ? <span>{t("ui.inUse")}</span> : profile.is_default ? <span>{t("ui.default")}</span> : <button disabled={setupPending} onClick={() => setDefaultModelProfile(profile)} type="button">{t("ui.makeDefault")}</button>}
                      <button disabled={setupPending} onClick={() => testModelProfile(profile)} type="button">{t("ui.test")}</button>
                      <button disabled={setupPending} onClick={() => removeModelProfile(profile)} type="button">{t("ui.remove")}</button>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <form className="model-form" onSubmit={saveModelProfile}>
              <div className="setup-section-title">
                <span>03</span><div><h3>{editingModelProfileId ? t("ui.editModel") : t("ui.addModel")}</h3><p>{t("ui.giveItANameYouCan")}</p></div>
              </div>
              <label>
                <span>{t("ui.displayName2")}</span>
                <input
                  onChange={(event) => setModelProfileName(event.target.value)}
                  placeholder={t("ui.forExampleDeepReadingLocalQuick")}
                  value={modelProfileName}
                />
              </label>
              <label>
                <span>{t("ui.serviceType")}</span>
                <select
                  onChange={(event) => setModelDraft({ ...modelDraft, protocol: event.target.value as ModelProtocol })}
                  value={modelDraft.protocol}
                >
                  <option value="chat_completions">{t("ui.openaiCompatible")}</option>
                  <option value="responses">Responses</option>
                </select>
              </label>
              <label>
                <span>{t("ui.baseUrl")}</span>
                <input
                  onChange={(event) => setModelDraft({ ...modelDraft, base_url: event.target.value })}
                  placeholder={t("ui.forExampleHttp12700")}
                  type="url"
                  value={modelDraft.base_url}
                />
              </label>
              <label>
                <span>{t("ui.modelName")}</span>
                <input
                  onChange={(event) => setModelDraft({ ...modelDraft, model: event.target.value })}
                  placeholder={t("ui.forExampleQwen354b")}
                  value={modelDraft.model}
                />
              </label>
              <label>
                <span>{t("ui.apiKey")} {modelDraft.api_key_configured && <em>{t("ui.saved")}</em>}</span>
                <input
                  autoComplete="off"
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={modelDraft.api_key_configured ? t("ui.leaveBlankToKeepTheExisting") : t("ui.usuallyBlankForLocalServices")}
                  type="password"
                  value={apiKey}
                />
              </label>
              <div className="setup-actions">
                {editingModelProfileId && <button disabled={setupPending} onClick={cancelModelProfileEdit} type="button">{t("ui.cancel")}</button>}
                <button className="model-save" disabled={setupPending || !modelDraft.base_url || !modelDraft.model} type="submit">{editingModelProfileId ? t("ui.saveChanges") : t("ui.saveModel")}</button>
              </div>
            </form>

            <p className="setup-status" aria-live="polite">{setupStatus}</p>
          </section>
        </div>
      )}

      {showLocalSetup && (
        <div className="setup-backdrop" role="presentation" onMouseDown={() => setShowLocalSetup(false)}>
          <section
            aria-label={t("ui.localLibrary")}
            aria-modal="true"
            className="setup-drawer"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="setup-heading">
              <div>
                <p className="overline">{t("ui.yourLocalLibrary")}</p>
                <h2>{t("ui.manageYourLocalLibrary")}</h2>
              </div>
              <button aria-label={t("ui.closeLocalLibrary")} onClick={() => setShowLocalSetup(false)} type="button">×</button>
            </div>

            <p className="privacy-callout">
              {t("ui.booksReadingTracesFilesAndIndexes")}
            </p>

            <div className="library-shelf-manager">
              <div className="setup-section-title">
                <span>01</span><div><h3>{t("ui.myShelf")}</h3><p>{t("ui.aBookExistsIndependentlyOfIts")}</p></div>
              </div>
              <button className="library-import-link" onClick={() => { setShowLocalSetup(false); setShowImportCenter(true); setImportTab("books"); }} type="button">{t("ui.importABookSourceOrReading")} <span>↗</span></button>
              <div className="shelf-list">
                {libraryBooks.length === 0 && <p className="empty-library">{t("ui.addABookFirstYouCan")}</p>}
                {libraryBooks.map((book) => (
                  <article className={selectedLibraryBookId === book.id ? "selected" : ""} key={book.id}>
                    <button className="shelf-select" onClick={() => selectLibraryBook(book)} type="button">
                      <span className="shelf-spine">{book.title.slice(0, 1)}</span>
                      <span><strong>{book.title}</strong><small>{book.author ?? t("ui.authorNotAdded")} · {book.note_count} {t("ui.readingTraces2")} · {book.document_count} {t("ui.sources")}</small></span>
                    </button>
                    <select
                      aria-label={t("ui.updateReadingStatusFor", { value0: book.title })}
                      onChange={(event) => updateReadingStatus(book, event.target.value as ReadingStatus)}
                      value={book.reading_status}
                    >
                      {(Object.keys(readingStatusLabels) as ReadingStatus[]).map((status) => (
                        <option key={status} value={status}>{readingStatusLabels[status]}</option>
                      ))}
                    </select>
                    <button className="document-delete" onClick={() => removeLibraryBook(book)} type="button">{t("ui.remove")}</button>
                  </article>
                ))}
              </div>
            </div>

            <div className="book-room-manager">
              <div className="setup-section-title">
                <span>02</span><div><h3>{t("ui.howThisBookShouldMeetYou")}</h3><p>{t("ui.setTheRoomAndSpoilerBoundary")}</p></div>
              </div>
              {!selectedLibraryBook && <p className="empty-library">{t("ui.chooseABookFromTheShelf")}</p>}
              {selectedLibraryBook && (
                <form className="book-room-form" key={selectedLibraryBook.id} onSubmit={saveBookRoomSettings}>
                  <label><span>{t("ui.isbnBarcode")}</span><input defaultValue={selectedLibraryBook.isbn ?? ""} name="isbn" placeholder={t("ui.enterItManuallyScanningWillFollow")} /></label>
                  <label><span>{t("ui.myProgress")}</span><input defaultValue={selectedLibraryBook.reading_progress ?? ""} name="reading_progress" placeholder={t("ui.forExampleChapter358Finished")} /></label>
                  <label><span>{t("ui.spoilerBoundary")}</span><select defaultValue={selectedLibraryBook.spoiler_policy} name="spoiler_policy">{(Object.keys(spoilerPolicyLabels) as SpoilerPolicy[]).map((policy) => <option key={policy} value={policy}>{spoilerPolicyLabels[policy]}</option>)}</select></label>
                  <label><span>{t("ui.companionStance")}</span><select defaultValue={selectedLibraryBook.companion_stance} name="companion_stance">{(Object.keys(companionStanceLabels) as CompanionStance[]).map((stance) => <option key={stance} value={stance}>{companionStanceLabels[stance]}</option>)}</select></label>
                  <label className="book-room-intent"><span>{t("ui.whatDoYouWantFromThis")}</span><textarea defaultValue={selectedLibraryBook.room_intent ?? ""} name="room_intent" placeholder={t("ui.forExampleDoNotRushTo")} /></label>
                  <button disabled={setupPending} type="submit">{t("ui.saveRoomPreferences")}</button>
                </form>
              )}
            </div>

            <div className="reading-capture-manager">
              <div className="setup-section-title">
                <span>03</span><div><h3>{t("ui.keepAReadingTrace")}</h3><p>{t("ui.aQuoteReflectionOrQuestionIs")}</p></div>
              </div>
              {!selectedLibraryBook && <p className="empty-library">{t("ui.chooseAShelfItemThenPaste")}</p>}
              {selectedLibraryBook && (
                <>
                  <form className="reading-capture-form" onSubmit={captureReadingNote}>
                    <select defaultValue="reflection" name="kind">
                      {(Object.keys(readingNoteKindLabels) as ReadingNoteKind[]).map((kind) => <option key={kind} value={kind}>{readingNoteKindLabels[kind]}</option>)}
                    </select>
                    <input name="locator" placeholder={t("ui.locationOptionalChapterPageProgress")} />
                    <textarea name="quote" placeholder={t("ui.quoteOrHighlightOptional")} />
                    <textarea name="content" placeholder={t("ui.whatDoYouWantToKeep")} required />
                    <button disabled={setupPending} type="submit">{t("ui.saveToThisBook")}</button>
                  </form>
                  <div className="reading-note-list">
                    {readingNotes.length === 0 && <p className="empty-library">{t("ui.noReadingTracesYetYouDo")}</p>}
                    {readingNotes.map((note) => (
                      <article key={note.id}>
                        <span>{readingNoteKindLabels[note.kind]}</span>
                        <div>{note.quote && <blockquote>{note.quote}</blockquote>}<p>{note.content}</p>{note.locator && <small>{note.locator}</small>}</div>
                        <button aria-label={t("ui.deleteReadingTrace")} className="document-delete" onClick={() => removeReadingNote(note)} type="button">{t("ui.delete")}</button>
                      </article>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="library-manager">
              <div className="setup-section-title">
                <span>04</span><div><h3>{t("ui.editionsSources")}</h3><p>{t("ui.importReassignAndReviewSourcesIn")}</p></div>
              </div>
              <button className="library-import-link" onClick={() => { setShowLocalSetup(false); setShowImportCenter(true); setImportTab("files"); }} type="button">{t("ui.openImportCenterLocalSources", { value0: documents.length })} <span>↗</span></button>
            </div>

            <p className="setup-status" aria-live="polite">{setupStatus}</p>
          </section>
        </div>
      )}

      <section className={`workspace ${showRecommendations ? "recommendations-open" : ""}`}>
        <aside className="companion-panel reveal reveal-two">
          <div className="companion-profile">
            <div className="portrait-wrap">
              <div className="portrait">{t("ui.b2")}</div>
              <span className="ai-label">AI</span>
            </div>
            <div>
              <p className="overline">{t("ui.yourPrivateAiBookFriend2")}</p>
              <h1>{t("ui.bookmate")}</h1>
              <p className="identity-copy">{t("ui.continueTheConversationsThatAreNot")}</p>
            </div>
          </div>

          <button
            className="new-conversation-button"
            onClick={() => switchMode(mode, mode === "book_room" ? activeBookTitle : undefined)}
            type="button"
          >
            <span>＋</span>
            {t("ui.newConversation")}
          </button>

          <nav className="companion-nav" aria-label={t("ui.bookmateNavigation")}>
            <p className="companion-nav-label">{t("ui.now")}</p>
            <button
              className={mode === "book_room" ? "active" : ""}
              onClick={() => {
                if (mode === "book_room") composerRef.current?.focus();
                else switchMode("book_room", activeBookTitle);
              }}
              type="button"
            >
              <span className="companion-nav-mark">{t("ui.b3")}</span>
              <span><strong>{formatBookTitle(activeBookDisplayTitle, uiLanguage)}</strong><small>{t("ui.currentBookRoom")}</small></span>
            </button>
            <button
              className={mode === "general_companion" ? "active" : ""}
              onClick={() => mode === "general_companion" ? composerRef.current?.focus() : switchMode("general_companion")}
              type="button"
            >
              <span className="companion-nav-mark">{t("ui.c")}</span>
              <span><strong>{t("ui.openConversation")}</strong><small>{t("ui.acrossBooksAndLife")}</small></span>
            </button>

            <p className="companion-nav-label">{t("ui.myReading")}</p>
            <button onClick={() => setShowLocalSetup(true)} type="button">
              <span className="companion-nav-mark">{t("ui.l")}</span>
              <span><strong>{t("ui.privateLibrary")}</strong><small>{libraryBooks.length} {t("ui.books")}</small></span>
            </button>
            <button onClick={() => setShowImportCenter(true)} type="button">
              <span className="companion-nav-mark">{t("ui.i")}</span>
              <span><strong>{t("ui.importReading")}</strong><small>{documents.length} {t("ui.localSources")}</small></span>
            </button>
            <button onClick={() => setShowRelationship(true)} type="button">
              <span className="companion-nav-mark">{t("ui.m")}</span>
              <span><strong>{t("ui.conversationsMemory")}</strong><small>{memories.filter((memory) => memory.status === "confirmed").length} {t("ui.confirmedByYou")}</small></span>
            </button>
          </nav>

          <div className="companion-panel-footer">
            <p className="local-trust"><i />{t("ui.storedLocallyOnlyConfirmedMemoriesRemain")}</p>
            <button className="preferences-entry" onClick={() => setShowPreferences(true)} type="button">
              <span className="preferences-entry-mark">{t("ui.s")}</span>
              <span>
                <strong>{t("ui.preferencesModels")}</strong>
                <small>{readerProfile.display_name
                  ? t("ui.personalSettings", { value0: readerProfile.display_name })
                  : t("ui.nameModelsPrivacy")}</small>
              </span>
              <b>›</b>
            </button>
          </div>
        </aside>

        <section className={`conversation-panel reveal reveal-three ${messages.length <= 1 ? "conversation-empty" : "conversation-active"}`}>
          <div className="book-heading">
            <div>
              <p className="overline">{mode === "book_room" ? t("ui.inThisBookRoom") : t("ui.openConversation2")}</p>
              <h2>{mode === "book_room" ? formatBookTitle(activeBookDisplayTitle, uiLanguage) : t("ui.beginWithYourQuestion")}</h2>
              <p>{mode === "book_room"
                ? (activeDocument
                  ? t("ui.yourLocalSourcesCitedWhenHelpful")
                  : t("ui.continueFromYourReading"))
                : t("ui.acrossBooksLifeAndIdeas")}</p>
            </div>
            <div className="book-heading-actions">
              <div className="mode-switch" aria-label={t("ui.chooseConversationMode")}>
                <button
                  className={mode === "general_companion" ? "active" : ""}
                  onClick={() => switchMode("general_companion")}
                  type="button"
                >{t("ui.openChat")}</button>
                <button
                  className={mode === "book_room" ? "active" : ""}
                  onClick={() => switchMode("book_room")}
                  type="button"
                >{t("ui.bookRoom2")}</button>
              </div>
              <button
                aria-expanded={showRecommendations}
                className="next-book-button"
                onClick={() => setShowRecommendations((current) => !current)}
                type="button"
              >{showRecommendations ? t("ui.closeReadingPaths") : t("ui.whatToReadNext")}</button>
            </div>
          </div>

          <div className="conversation-body">
            <div className={`conversation-stream ${messages.length <= 1 ? "conversation-welcome" : ""}`} aria-live="polite" ref={conversationStreamRef}>
              {messages.map((message) => (
                <article className={`message message-${message.role}`} key={message.id}>
                  {message.role === "companion" && (
                    <div className="message-meta">
                      <span>{t("ui.bookmate")}</span>
                      {message.move && <em>{messageMoveForDisplay(message.move, uiLanguage)}</em>}
                    </div>
                  )}
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
                      {message.errorAction === "settings" ? t("ui.checkModelSettings") : t("ui.sendAgain")}
                    </button>
                  )}
                  {message.role === "companion" && message.memoryId && message.memoryText && (
                    <div className="memory-candidate">
                      <span>{t("ui.rememberThis")}{message.memoryText}</span>
                      <button onClick={() => confirmMemory({
                        id: message.memoryId!, conversation_id: conversationId ?? "", scope: mode === "book_room" ? "book" : "global", book_title: activeBookTitle, content: message.memoryText!, status: "pending", created_at: "",
                      })} type="button">{t("ui.remember")}</button>
                      <button onClick={() => removeMemory({
                        id: message.memoryId!, conversation_id: conversationId ?? "", scope: mode === "book_room" ? "book" : "global", book_title: activeBookTitle, content: message.memoryText!, status: "pending", created_at: "",
                      })} type="button">{t("ui.notNow")}</button>
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
                <div className="thinking"><i /><i /><i /><span>{t("ui.bookmateIsConsideringHowToMeet")}</span></div>
              )}
            </div>

            <div className="composer-wrap">
              <form className="composer" onSubmit={submitMessage}>
                <textarea
                  aria-label={t("ui.shareWhatStayedWithYouAfter")}
                  maxLength={4000}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder={mode === "book_room"
                    ? t("ui.noNeedToOrganizeItStart")
                    : t("ui.beginWithAQuestionAJudgment")}
                  ref={composerRef}
                  rows={1}
                  value={input}
                />
                <div className="composer-footer">
                  <div className="composer-tools">
                    <div className="direction-tabs" aria-label={t("ui.chooseAConversationDirection")}>
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
                      <span>{t("ui.model")}</span>
                      <select aria-label={t("ui.chooseTheModelForThisConversation2")} onChange={(event) => setSelectedModelProfileId(event.target.value || null)} value={selectedModelProfileId ?? ""}>
                        <option value="">{modelSettings.model ? modelNameForDisplay(modelSettings.model, uiLanguage) : t("ui.noModelSelected")}</option>
                        {modelProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profileNameForDisplay(profile, uiLanguage)}{profile.is_default ? t("ui.default2") : ""}</option>)}
                      </select>
                      <button onClick={() => setShowPreferences(true)} type="button">{t("ui.manage")}</button>
                    </label>
                  </div>
                  <button disabled={!input.trim() || pending} type="submit">
                    <span className="submit-label-full">{pending ? t("ui.responding") : t("ui.sendToBookmate")}</span>
                    <span className="submit-label-short">{pending ? t("ui.replying") : t("ui.send")}</span>
                    <b>↗</b>
                  </button>
                </div>
              </form>
              {composerNotice && <p className="composer-notice" aria-live="polite">{composerNotice}</p>}
            </div>
          </div>
        </section>

        <aside className={`recommendation-panel ${showRecommendations ? "is-open" : ""}`}>
          <div className="recommendation-heading">
            <div>
              <p className="overline">{t("ui.readNext")}</p>
              <h2>{t("ui.followThisResonance")}</h2>
            </div>
            <button aria-label={t("ui.closeReadingPaths2")} className="recommendation-close" onClick={() => setShowRecommendations(false)} type="button">{t("ui.close")}</button>
          </div>
          <p className="recommendation-intro">
            {t("ui.notARankingBookmateLeavesOne")}
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
                  <summary>{t("ui.whyItMayNotFit")}</summary>
                  <p>{item.book.caution}</p>
                </details>
                <button onClick={() => startRecommendationConversation(item)} type="button">
                  {t("ui.enterWithAQuestion")} <span>↗</span>
                </button>
              </article>
            ))}
          </div>

          <button className="different-button" onClick={changeRecommendationDirection} type="button">
            {showAlternativeRecommendations
              ? t("ui.returnToTheFirstThreePaths")
              : t("ui.showMeSomethingEntirelyDifferent")}
          </button>
          <p className="commercial-note">{t("ui.recommendationsDoNotUsePricesOr")}</p>
        </aside>
      </section>
    </main>
  );
}

function flowMoveLabel(move: string, language: UiLanguage): string {
  const keys: Record<string, UiCopyKey> = {
    listen: "system.listening",
    mirror: "system.reflecting",
    tension: "system.findingTension",
    connect: "system.connectingToLife",
  };
  return translate(language, keys[move] ?? "system.thinkingTogether");
}

function messageMoveForDisplay(move: string, language: UiLanguage): string {
  const key = legacyMoveKeys[move];
  return key ? translate(language, key) : move;
}

function searchDecisionNote(action: string | undefined, language: UiLanguage): string | undefined {
  const keys: Record<string, UiCopyKey> = {
    disabled: "system.searchDisabled",
    permission_required: "system.searchPermissionRequired",
    would_search: "system.searchWouldRun",
  };
  return action && keys[action] ? translate(language, keys[action]) : undefined;
}

function memoryScopeLabel(scope: MemoryScope, language: UiLanguage): string {
  const keys: Record<MemoryScope, UiCopyKey> = {
    global: "system.memoryAcrossBooks",
    book: "system.memoryThisBook",
    session: "system.memoryThisConversation",
  };
  return translate(language, keys[scope]);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
