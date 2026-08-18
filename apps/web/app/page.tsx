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
type UiLanguage = "zh" | "en";

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

const directionOptionsByLanguage: Record<UiLanguage, Array<{ id: Direction; label: string; note: string }>> = {
  zh: [
    { id: "follow", label: "顺着聊", note: "先把这个想法说清" },
    { id: "challenge", label: "较真一点", note: "给我一个真正的反方" },
    { id: "life", label: "联系生活", note: "看看它为何触动了我" },
  ],
  en: [
    { id: "follow", label: "Follow", note: "Help me make this thought clearer" },
    { id: "challenge", label: "Challenge", note: "Give me a genuine counterpoint" },
    { id: "life", label: "Connect", note: "Connect this thought with my life" },
  ],
};

const laneLabelsByLanguage: Record<UiLanguage, Record<Lane, string>> = {
  zh: { continue: "延续", counterpoint: "反面", crossover: "跨越" },
  en: { continue: "Continue", counterpoint: "Counterpoint", crossover: "Cross over" },
};

function localize(language: UiLanguage, chinese: string, english: string) {
  return language === "zh" ? chinese : english;
}

function formatBookTitle(title: string, language: UiLanguage) {
  return language === "zh" ? `《${title}》` : title;
}

function modelNameForDisplay(model: string, language: UiLanguage = "zh") {
  const value = model.trim();
  if (!value) return localize(language, "未命名模型", "Unnamed model");
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
    return new ChatResponseError(localize(language, "书友模型没有通过验证。请检查模型设置后再试。", "The selected model could not be authenticated. Check Model Settings and try again."), "settings");
  }
  if (response.status === 408 || response.status === 504 || hasDetail(["timeout", "timed out"])) {
    return new ChatResponseError(localize(language, "书友模型这次等得有些久。请稍后重新发送。", "The model took too long to respond. Please try sending this again."), "retry");
  }
  if (hasDetail(["connecterror", "connection", "network is unreachable", "connection refused"])) {
    return new ChatResponseError(localize(language, "书友模型暂时无法连接。请检查模型设置后再试。", "BookMate cannot reach the selected model. Check Model Settings and try again."), "settings");
  }
  if (response.status === 422) {
    return new ChatResponseError(localize(language, "这句话暂时无法发送。请确认当前书房后再试。", "This message could not be sent. Check the current book room and try again."), "retry");
  }
  if (response.status >= 500) {
    return new ChatResponseError(localize(language, "这次对话没有完成。请重新发送；若持续发生，请检查模型设置。", "The response was interrupted. Try again, or check Model Settings if this keeps happening."), "retry");
  }
  return new ChatResponseError(localize(language, "这次没有得到完整回应。请重新发送。", "BookMate did not receive a complete response. Please try again."), "retry");
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

const welcomeByLanguage: Record<UiLanguage, Record<CompanionMode, string>> = {
  zh: {
    general_companion: "不必先选一本书。最近有没有一个念头，总在心里回来？你可以从它开始，我会先听你把话说完。",
    book_room: "先不急着谈《局外人》讲了什么。合上书以后，哪一个念头还没有离开你？",
  },
  en: {
    general_companion: "You do not need to choose a book first. Is there a thought that keeps returning lately? Start there; I will listen before we try to explain it.",
    book_room: "Before we explain what The Stranger is about: what thought stayed with you after you closed the book?",
  },
};

const searchPolicyLabelsByLanguage: Record<UiLanguage, Record<SearchPolicy, string>> = {
  zh: { off: "不联网", ask: "需要时先问我", auto: "动态问题自动查" },
  en: { off: "Offline", ask: "Ask before searching", auto: "Search when needed" },
};

const readingStatusLabelsByLanguage: Record<UiLanguage, Record<ReadingStatus, string>> = {
  zh: { want_to_read: "想读", reading: "在读", finished: "已读", paused: "暂搁" },
  en: { want_to_read: "Want to read", reading: "Reading", finished: "Finished", paused: "Paused" },
};

const spoilerPolicyLabelsByLanguage: Record<UiLanguage, Record<SpoilerPolicy, string>> = {
  zh: { avoid: "避免剧透", up_to_progress: "只到我的进度", allow: "允许完整讨论" },
  en: { avoid: "Avoid spoilers", up_to_progress: "Only to my progress", allow: "Full discussion" },
};

const companionStanceLabelsByLanguage: Record<UiLanguage, Record<CompanionStance, string>> = {
  zh: { explore: "陪我慢慢想", challenge: "和我认真较真", organize: "帮我整理线索", book_club: "准备读书会" },
  en: { explore: "Explore with me", challenge: "Challenge me", organize: "Organize the threads", book_club: "Prepare a book club" },
};

const readingNoteKindLabelsByLanguage: Record<UiLanguage, Record<ReadingNoteKind, string>> = {
  zh: { quote: "摘录", reflection: "读后感", question: "想继续问" },
  en: { quote: "Quote", reflection: "Reflection", question: "Question" },
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

const feedbackLabelsByLanguage: Record<UiLanguage, Record<MessageFeedback, string>> = {
  zh: { understood: "被理解", insightful: "有启发", off_base: "理解偏了" },
  en: { understood: "Felt understood", insightful: "Insightful", off_base: "Missed the point" },
};

export default function Home() {
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>("zh");
  const uiLanguageRef = useRef<UiLanguage>("zh");
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
  const [setupLoaded, setSetupLoaded] = useState(false);
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

  const t = (chinese: string, english: string) => localize(uiLanguage, chinese, english);
  const directionOptions = directionOptionsByLanguage[uiLanguage];
  const laneLabels = laneLabelsByLanguage[uiLanguage];
  const searchPolicyLabels = searchPolicyLabelsByLanguage[uiLanguage];
  const readingStatusLabels = readingStatusLabelsByLanguage[uiLanguage];
  const spoilerPolicyLabels = spoilerPolicyLabelsByLanguage[uiLanguage];
  const companionStanceLabels = companionStanceLabelsByLanguage[uiLanguage];
  const readingNoteKindLabels = readingNoteKindLabelsByLanguage[uiLanguage];
  const feedbackLabels = feedbackLabelsByLanguage[uiLanguage];

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
    ? t("局外人", "The Stranger")
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
    document.title = t("泊舟 · 与你把书谈深的 AI 书友", "BookMate · Your private AI book friend");
    setSetupStatus(setupLoaded
      ? (modelSettings.base_url && modelSettings.model
        ? t(`已准备好 ${modelNameForDisplay(modelSettings.model, uiLanguage)}。`, `${modelNameForDisplay(modelSettings.model, uiLanguage)} is ready.`)
        : t("还没有可用模型。添加一个后即可开始对话。", "No model is available yet. Add one to start a conversation."))
      : t("正在准备模型列表……", "Preparing your model list..."));
    setRelationshipStatus(t("记忆只会在你确认后用于未来对话。", "Only memories you confirm will be used in future conversations."));
    setMessages((current) => {
      if (conversationId || current.length !== 1 || current[0].role !== "companion") return current;
      const roomWelcome = uiLanguage === "zh"
        ? (mode === "book_room" && activeBookTitle !== "局外人"
          ? `关于《${activeBookTitle}》，不必从概括开始。把那句还留在心里的话告诉我；我们从那里继续。`
          : welcomeByLanguage.zh[mode])
        : (mode === "book_room" && activeBookTitle !== "局外人"
          ? `No need to begin by summarizing ${activeBookTitle}. Tell me the thought that stayed with you; we can continue from there.`
          : welcomeByLanguage.en[mode]);
      return [{ ...current[0], text: roomWelcome, move: t("邀请", "Invitation") }];
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
    setComposerNotice(t(
      `已带入《${item.book.title}》的切入问题；你可以改写后再交给泊舟。`,
      `A starting question from ${item.book.title} is ready. Edit it if you like, then send it to BookMate.`,
    ));
    focusComposer();
  }

  function changeRecommendationDirection() {
    setShowAlternativeRecommendations((current) => !current);
    setComposerNotice(showAlternativeRecommendations
      ? t("已回到原来的三种阅读邀请。", "Back to the original three reading invitations.")
      : t("已换一组不同的阅读入口；这不是外部搜索或商业排序。", "Here is a different set of reading paths. This is not an external search or commercial ranking."),
    );
  }

  function recordFeedback(messageId: string, feedback: MessageFeedback) {
    setFeedbackByMessage((current) => ({ ...current, [messageId]: feedback }));
    setComposerNotice(t(
      `已记下“${feedbackLabels[feedback]}”。这只用于调整本次对话，不会写入长期记忆。`,
      `Noted: “${feedbackLabels[feedback]}.” This adjusts the current conversation only and is not saved as long-term memory.`,
    ));
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
          ? t(
            `关于《${localTitle}》，不必从概括开始。把那句还留在心里的话告诉我；我们从那里继续。`,
            `No need to begin by summarizing ${localTitle}. Tell me the thought that stayed with you; we can continue from there.`,
          )
          : welcomeByLanguage[uiLanguage][nextMode],
        move: t("邀请", "Invitation"),
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
            text: responseLanguage === "zh" ? session.greeting : welcomeByLanguage.en.book_room,
            move: localize(responseLanguage, "邀请", "Invitation"),
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
    setSetupStatus(t("正在把这本书放进你的本地书架……", "Adding this book to your private library..."));
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
      setSetupStatus(t(`《${book.title}》已加入本地书架。现在可以上传版本、笔记或直接开始交流。`, `${book.title} is now in your library. Add an edition or note, or start talking right away.`));
    } catch (error) {
      setSetupStatus(t(`添加书籍失败：${error instanceof Error ? error.message : "未知错误"}`, `Could not add the book: ${error instanceof Error ? error.message : "Unknown error"}`));
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
      setSetupStatus(t(`《${updated.title}》的书房规则已保存。`, `Room preferences for ${updated.title} have been saved.`));
    } catch (error) {
      setSetupStatus(t(`保存书房规则失败：${error instanceof Error ? error.message : "未知错误"}`, `Could not save room preferences: ${error instanceof Error ? error.message : "Unknown error"}`));
    } finally {
      setSetupPending(false);
    }
  }

  async function captureReadingNote(event: FormEvent<HTMLFormElement>, targetBookId = selectedLibraryBookId) {
    event.preventDefault();
    if (!targetBookId) {
      setSetupStatus(t("先选择一本书，再把这条阅读痕迹留给它。", "Choose a book before saving this reading trace."));
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
      setSetupStatus(t(`这条阅读痕迹已保存到《${targetBook?.title ?? "所选书目"}》，并会在书房中作为你的线索。`, `This reading trace is saved to ${targetBook?.title ?? "the selected book"} and can inform its book room.`));
    } catch (error) {
      setSetupStatus(t(`保存阅读痕迹失败：${error instanceof Error ? error.message : "未知错误"}`, `Could not save the reading trace: ${error instanceof Error ? error.message : "Unknown error"}`));
    } finally {
      setSetupPending(false);
    }
  }

  async function removeReadingNote(note: ReadingNote) {
    if (!selectedLibraryBook) return;
    if (!window.confirm(t("删除这条摘录或读后感？它不会再作为书房线索。", "Delete this quote or reflection? It will no longer inform the book room."))) return;
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
      setSetupStatus(t("已删除这条本地阅读痕迹。 ", "The local reading trace has been deleted."));
    } catch {
      setSetupStatus(t("删除阅读痕迹失败，请稍后重试。 ", "Could not delete the reading trace. Please try again."));
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
      setSetupStatus(t("更新阅读状态失败，请稍后重试。", "Could not update reading status. Please try again."));
    }
  }

  async function removeLibraryBook(book: LibraryBook) {
    if (!window.confirm(t(`从书架移除《${book.title}》？关联文件会保留在“未归档资料”中。`, `Remove ${book.title} from the library? Attached files will remain under Unfiled.`))) return;
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
      setSetupStatus(t(`《${book.title}》已从书架移除；原始文件没有被删除。`, `${book.title} was removed from the library. Original files were not deleted.`));
    } catch {
      setSetupStatus(t("移除书籍失败，请稍后重试。", "Could not remove the book. Please try again."));
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
      setRelationshipStatus(t("已恢复本地对话。接下来会延续这段会话与已确认记忆。", "The local conversation has been restored with its confirmed memories."));
    } catch {
      setRelationshipStatus(t("恢复对话失败；原始数据仍保留在本机。请稍后重试。", "Could not restore the conversation. Its original data is still safe on this device."));
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
          ? { ...message, memoryId: undefined, systemNote: `${message.systemNote ?? ""} ${t("已确认写入本地记忆。", "Saved as confirmed local memory.")}`.trim() }
          : message
      )));
      setRelationshipStatus(t("已确认。这条记忆会按其作用范围参与后续对话。你可以随时删除它。", "Confirmed. This memory can inform future conversations within its scope, and you can delete it at any time."));
    } catch {
      setRelationshipStatus(t("保存记忆失败，请稍后重试。", "Could not save the memory. Please try again."));
    }
  }

  async function removeMemory(memory: LocalMemory) {
    if (!window.confirm(t("删除这条本地记忆？它不会再参与未来对话。", "Delete this local memory? It will no longer inform future conversations."))) return;
    try {
      const response = await fetch(`${API_BASE}/v1/memories/${memory.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Memory unavailable");
      await refreshRelationshipData();
      setMessages((current) => current.map((message) => (
        message.memoryId === memory.id
          ? { ...message, memoryId: undefined, systemNote: `${message.systemNote ?? ""} ${t("这条候选未被保存。", "This candidate was not saved.")}`.trim() }
          : message
      )));
      setRelationshipStatus(t("已删除本地记忆。 ", "The local memory has been deleted."));
    } catch {
      setRelationshipStatus(t("删除记忆失败，请稍后重试。", "Could not delete the memory. Please try again."));
    }
  }

  async function deleteConversation(summary: ConversationSummary) {
    if (!window.confirm(t(`删除“${summary.title}”及其消息和关联记忆？此操作无法撤销。`, `Delete “${summary.title}”, its messages, and related memories? This cannot be undone.`))) return;
    try {
      const response = await fetch(`${API_BASE}/v1/conversations/${summary.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Conversation unavailable");
      if (conversationId === summary.id) {
        setConversationId(null);
        switchMode(mode);
      }
      await refreshRelationshipData();
      setRelationshipStatus(t("已删除这段本地对话及其关联记忆。", "The local conversation and its related memories have been deleted."));
    } catch {
      setRelationshipStatus(t("删除对话失败，请稍后重试。", "Could not delete the conversation. Please try again."));
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
      setRelationshipStatus(t("已导出会话、记忆和书库元数据；原始书籍文件不会自动打包。 ", "Conversations, memories, and library metadata have been exported. Original book files are not included automatically."));
    } catch {
      setRelationshipStatus(t("导出失败，请确认本地 API 正在运行。", "Export failed. Make sure the local BookMate service is running."));
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
            ? localize(responseLanguage, `已准备好 ${modelNameForDisplay(settings.model, responseLanguage)}。`, `${modelNameForDisplay(settings.model, responseLanguage)} is ready.`)
            : localize(responseLanguage, "还没有可用模型。添加一个后即可开始对话。", "No model is available yet. Add one to start a conversation."),
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
      setSetupStatus(t("无法读取模型列表，请确认应用已启动。", "Could not load the model list. Make sure BookMate is running."));
    }
  }

  async function saveReaderProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSetupPending(true);
    setSetupStatus(t("正在保存本地界面配置……", "Saving interface preferences..."));
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
        ? t(`已将本地界面称呼设为“${profile.display_name}”。`, `Your interface name is now “${profile.display_name}.”`)
        : t("已恢复默认的界面称呼。", "The default interface name has been restored."));
    } catch (error) {
      setSetupStatus(t(`保存用户配置失败：${error instanceof Error ? error.message : "未知错误"}`, `Could not save your preferences: ${error instanceof Error ? error.message : "Unknown error"}`));
    } finally {
      setSetupPending(false);
    }
  }

  async function saveModelProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSetupPending(true);
    setSetupStatus(t("正在保存模型……", "Saving model..."));
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
      setSetupStatus(t(`“${profileNameForDisplay(profile, uiLanguage)}”已保存，并将在本轮对话使用。`, `“${profileNameForDisplay(profile, uiLanguage)}” has been saved and selected for this conversation.`));
    } catch (error) {
      setSetupStatus(t(`保存失败：${error instanceof Error ? error.message : "未知错误"}`, `Save failed: ${error instanceof Error ? error.message : "Unknown error"}`));
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
    setSetupStatus(t(`正在编辑“${profileNameForDisplay(profile, uiLanguage)}”。访问密钥留空即可保留。`, `Editing “${profileNameForDisplay(profile, uiLanguage)}.” Leave the API key blank to keep the existing one.`));
  }

  function cancelModelProfileEdit() {
    setEditingModelProfileId(null);
    setModelProfileName("");
    setApiKey("");
    setModelDraft(emptyModelSettings());
  }

  async function testModelProfile(profile: ModelProfile) {
    setSetupPending(true);
    setSetupStatus(t(`正在确认“${profileNameForDisplay(profile, uiLanguage)}”是否可用……`, `Testing “${profileNameForDisplay(profile, uiLanguage)}”...`));
    try {
      const response = await fetch(`${API_BASE}/v1/settings/models/${profile.id}/test`, { method: "POST" });
      const result = await response.json();
      setSetupStatus(
        result.ok
          ? t(`“${profileNameForDisplay(profile, uiLanguage)}”已可用 · 用时 ${result.latency_ms}ms`, `“${profileNameForDisplay(profile, uiLanguage)}” is ready · ${result.latency_ms}ms`)
          : t(`暂时无法使用 · ${result.message}`, `Unavailable · ${result.message}`),
      );
    } catch (error) {
      setSetupStatus(t(`连接失败：${error instanceof Error ? error.message : "未知错误"}`, `Connection failed: ${error instanceof Error ? error.message : "Unknown error"}`));
    } finally {
      setSetupPending(false);
    }
  }

  async function testEnvironmentModel() {
    setSetupPending(true);
    setSetupStatus(t(`正在确认“${modelNameForDisplay(modelSettings.model, uiLanguage)}”是否可用……`, `Testing “${modelNameForDisplay(modelSettings.model, uiLanguage)}”...`));
    try {
      const response = await fetch(`${API_BASE}/v1/settings/model/test`, { method: "POST" });
      const result = await response.json();
      setSetupStatus(
        result.ok
          ? t(`“${modelNameForDisplay(result.model, uiLanguage)}”已可用 · 用时 ${result.latency_ms}ms`, `“${modelNameForDisplay(result.model, uiLanguage)}” is ready · ${result.latency_ms}ms`)
          : t(`暂时无法使用 · ${result.message || "模型服务没有返回可读结果"}`, `Unavailable · ${result.message || "The model service did not return a readable result"}`),
      );
    } catch (error) {
      setSetupStatus(t(`确认模型失败：${error instanceof Error ? error.message : "未知错误"}`, `Model test failed: ${error instanceof Error ? error.message : "Unknown error"}`));
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
      setSetupStatus(t(`“${profileNameForDisplay(profile, uiLanguage)}”已设为新对话默认模型。`, `“${profileNameForDisplay(profile, uiLanguage)}” is now the default for new conversations.`));
    } catch (error) {
      setSetupStatus(t(`更新默认模型失败：${error instanceof Error ? error.message : "未知错误"}`, `Could not update the default model: ${error instanceof Error ? error.message : "Unknown error"}`));
    } finally {
      setSetupPending(false);
    }
  }

  async function removeModelProfile(profile: ModelProfile) {
    if (!window.confirm(t(`移除“${profileNameForDisplay(profile, uiLanguage)}”？这不会影响模型服务。`, `Remove “${profileNameForDisplay(profile, uiLanguage)}”? This will not change the model service itself.`))) return;
    setSetupPending(true);
    try {
      const response = await fetch(`${API_BASE}/v1/settings/models/${profile.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await response.text());
      await refreshModelProfiles();
      setSetupStatus(t(`“${profileNameForDisplay(profile, uiLanguage)}”已移除。`, `“${profileNameForDisplay(profile, uiLanguage)}” has been removed.`));
    } catch (error) {
      setSetupStatus(t(`移除模型配置失败：${error instanceof Error ? error.message : "未知错误"}`, `Could not remove the model profile: ${error instanceof Error ? error.message : "Unknown error"}`));
    } finally {
      setSetupPending(false);
    }
  }

  async function uploadDocument(file: File | undefined, targetBookId = selectedLibraryBookId) {
    if (!file) return;
    setSetupPending(true);
    setSetupStatus(t(`正在本机解析《${file.name}》……`, `Parsing ${file.name} locally...`));
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
      setSetupStatus(t(`《${document.name}》已在本机建立 ${document.chunk_count} 个文本片段。`, `${document.name} was parsed locally into ${document.chunk_count} text chunks.`));
    } catch (error) {
      setSetupStatus(t(`导入失败：${error instanceof Error ? error.message : "未知错误"}`, `Import failed: ${error instanceof Error ? error.message : "Unknown error"}`));
    } finally {
      setSetupPending(false);
    }
  }

  async function removeDocument(document: KnowledgeDocument) {
    if (!window.confirm(t(`删除《${document.name}》及其本地索引？此操作不会删除你的原始购书文件。`, `Delete ${document.name} and its local index? Your original purchased file will not be deleted.`))) return;
    const response = await fetch(`${API_BASE}/v1/knowledge/documents/${document.id}`, { method: "DELETE" });
    if (!response.ok) {
      setSetupStatus(t("删除失败，请稍后重试。", "Delete failed. Please try again."));
      return;
    }
    setDocuments((current) => current.filter((item) => item.id !== document.id));
    if (selectedDocumentId === document.id) setSelectedDocumentId(null);
    // The shelf item remains the active conversation context even if one version is removed.
    if (document.book_id) refreshLibraryData();
    setSetupStatus(t(`已删除《${document.name}》的 BookMate 本地副本和索引。`, `The BookMate copy and local index for ${document.name} have been deleted.`));
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
        ? t(`《${updated.name}》已归入《${owner.title}》。`, `${updated.name} is now attached to ${owner.title}.`)
        : t(`《${updated.name}》已移回未归档资料。`, `${updated.name} has been moved back to Unfiled.`));
    } catch (error) {
      setSetupStatus(t(`调整归档失败：${error instanceof Error ? error.message : "未知错误"}`, `Could not change the file assignment: ${error instanceof Error ? error.message : "Unknown error"}`));
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
        data.citations?.length ? t(`本轮参考了 ${data.citations.length} 条本地资料或阅读痕迹，可在后续证据抽屉中核验。`, `This response used ${data.citations.length} local sources or reading traces. You can review them in the evidence view.`) : undefined,
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
            ? t("这次没有得到完整回应。请重新发送。", "BookMate did not receive a complete response. Please try again.")
            : t("暂时无法连接 BookMate。请确认应用仍在运行后重新发送。", "BookMate is not reachable. Make sure the local app is still running, then try again."),
          "retry",
        );
      setApiOnline(receivedResponse);
      setMessages((current) => [
        ...current,
        {
          id: `chat-error-${Date.now()}`,
          role: "companion",
          text: chatError.message,
          move: t("稍后再试", "Try again"),
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
          <span className="brand-mark">{t("泊", "B")}</span>
          <div>
            <p className="brand-name">{t("泊舟", "BookMate")}</p>
            <p className="brand-subtitle">{t("与你把书谈深的 AI 书友", "Your private AI book friend")}</p>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="language-switch" aria-label={t("界面语言", "Interface language")}>
            <button aria-pressed={uiLanguage === "zh"} className={uiLanguage === "zh" ? "active" : ""} onClick={() => changeUiLanguage("zh")} type="button">中</button>
            <button aria-pressed={uiLanguage === "en"} className={uiLanguage === "en" ? "active" : ""} onClick={() => changeUiLanguage("en")} type="button">EN</button>
          </div>
          <label className="search-policy">
            <span>{t("联网", "Web")}</span>
            <select
              aria-label={t("联网搜索策略", "Web search policy")}
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
            {apiOnline === null ? t("正在准备", "Starting") : apiOnline ? t("BookMate 已启动", "BookMate is ready") : t("离线预览", "Offline preview")}
          </span>
        </div>
      </header>

      {showRelationship && (
        <div className="setup-backdrop" role="presentation" onMouseDown={() => setShowRelationship(false)}>
          <section
            aria-label={t("本地对话与记忆", "Local conversations and memories")}
            aria-modal="true"
            className="relationship-drawer"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="setup-heading">
              <div>
                <p className="overline">{t("延续，而非监视", "Continuity, not surveillance")}</p>
                <h2>{t("我们记得的事", "What we remember")}</h2>
              </div>
              <button aria-label={t("关闭对话与记忆", "Close conversations and memories")} onClick={() => setShowRelationship(false)} type="button">×</button>
            </div>
            <p className="privacy-callout">
              {t("对话保存在你的电脑里。只有你确认的记忆才会在未来被带入；待确认候选不会自动变成长期画像。", "Conversations stay on this computer. Only memories you confirm can be carried into the future; pending candidates never become a profile automatically.")}
            </p>

            <div className="relationship-section">
              <div className="setup-section-title">
                <span>01</span><div><h3>{t("继续一段对话", "Continue a conversation")}</h3><p>{t("每段对话都可单独删除", "Each conversation can be deleted separately")}</p></div>
              </div>
              <div className="conversation-list">
                {conversations.length === 0 && <p className="empty-library">{t("还没有保存的对话。第一轮认真聊天后，它会出现在这里。", "No conversations are saved yet. Your first thoughtful exchange will appear here.")}</p>}
                {conversations.map((conversation) => (
                  <article className={conversation.id === conversationId ? "selected" : ""} key={conversation.id}>
                    <button className="conversation-select" onClick={() => continueConversation(conversation)} type="button">
                      <strong>{conversation.title}</strong>
                      <small>{conversation.book_title ?? t("广泛书友", "Open conversation")} · {conversation.message_count} {t("条消息", "messages")}</small>
                    </button>
                    <button className="document-delete" onClick={() => deleteConversation(conversation)} type="button">{t("删除", "Delete")}</button>
                  </article>
                ))}
              </div>
            </div>

            <div className="relationship-section">
              <div className="setup-section-title">
                <span>02</span><div><h3>{t("待你确认的记忆", "Memories awaiting you")}</h3><p>{t("确认后才会参与以后对话", "Only confirmed memories inform future conversations")}</p></div>
              </div>
              <div className="memory-list">
                {memories.filter((memory) => memory.status === "pending").length === 0 && <p className="empty-library">{t("没有待确认的候选。", "No memory candidates are waiting.")}</p>}
                {memories.filter((memory) => memory.status === "pending").map((memory) => (
                  <article key={memory.id}>
                    <p>{memory.content}</p>
                    <div><span>{memoryScopeLabel(memory.scope, uiLanguage)}</span><button onClick={() => confirmMemory(memory)} type="button">{t("确认", "Confirm")}</button><button onClick={() => removeMemory(memory)} type="button">{t("不保存", "Do not save")}</button></div>
                  </article>
                ))}
              </div>
            </div>

            <div className="relationship-section confirmed-memories">
              <div className="setup-section-title">
                <span>03</span><div><h3>{t("已经确认的线索", "Confirmed threads")}</h3><p>{t("可以随时删除或重新开始", "Delete them or begin again at any time")}</p></div>
              </div>
              <div className="memory-list">
                {memories.filter((memory) => memory.status === "confirmed").length === 0 && <p className="empty-library">{t("还没有长期线索。", "There are no long-term threads yet.")}</p>}
                {memories.filter((memory) => memory.status === "confirmed").map((memory) => (
                  <article key={memory.id}>
                    <p>{memory.content}</p>
                    <div><span>{memoryScopeLabel(memory.scope, uiLanguage)}</span><button onClick={() => removeMemory(memory)} type="button">{t("删除", "Delete")}</button></div>
                  </article>
                ))}
              </div>
            </div>

            <div className="relationship-export">
              <button onClick={downloadExport} type="button">{t("导出我的本地数据", "Export my local data")}</button>
              <p>{t("导出会话、记忆和书库元数据；不会自动包含原始书籍文件或 API Key。", "Exports conversations, memories, and library metadata. Original book files and API keys are never included automatically.")}</p>
            </div>
            <p className="setup-status" aria-live="polite">{relationshipStatus}</p>
          </section>
        </div>
      )}

      {showImportCenter && (
        <div className="import-backdrop" role="presentation" onMouseDown={() => setShowImportCenter(false)}>
          <section
            aria-label={t("导入中心", "Import center")}
            aria-modal="true"
            className="import-workbench"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="import-heading">
              <div>
                <p className="overline">{t("把阅读带进来", "Bring your reading in")}</p>
                <h2>{t("导入中心", "Import center")}</h2>
                <p>{t("先决定内容属于哪本书，再选择最自然的带入方式。导入不会覆盖你原有的书目、笔记或文件。", "First decide which book this belongs to, then choose the easiest way to bring it in. Importing never overwrites existing books, notes, or files.")}</p>
              </div>
              <button aria-label={t("关闭导入中心", "Close import center")} onClick={() => setShowImportCenter(false)} type="button">×</button>
            </header>

            <div className="import-stats" aria-label={t("本地资料概览", "Local content overview")}>
              <div><strong>{libraryBooks.length}</strong><span>{t("本书书房", "Book rooms")}</span></div>
              <div><strong>{documents.length}</strong><span>{t("本地文件", "Local files")}</span></div>
              <div><strong>{documents.filter((document) => !document.book_id).length}</strong><span>{t("待归档资料", "Unfiled")}</span></div>
            </div>

            <nav className="import-tabs" aria-label={t("选择导入方式", "Choose an import method")}>
              <button className={importTab === "files" ? "active" : ""} onClick={() => setImportTab("files")} type="button">
                <span>01</span><strong>{t("文件与版本", "Files & editions")}</strong><small>EPUB, PDF, TXT, Markdown</small>
              </button>
              <button className={importTab === "notes" ? "active" : ""} onClick={() => setImportTab("notes")} type="button">
                <span>02</span><strong>{t("阅读痕迹", "Reading traces")}</strong><small>{t("摘录、感想与问题", "Quotes, reflections, questions")}</small>
              </button>
              <button className={importTab === "books" ? "active" : ""} onClick={() => setImportTab("books")} type="button">
                <span>03</span><strong>{t("先建一本书", "Create a book first")}</strong><small>{t("没有文件也能开始", "No file required")}</small>
              </button>
            </nav>

            {importTab === "files" && (
              <section className="import-stage">
                <div className="import-stage-heading">
                  <div><p className="overline">{t("文件导入", "File import")}</p><h3>{t("把版本或资料放进书房", "Add an edition or source to a book room")}</h3></div>
                  <label className="import-target"><span>{t("归属书房", "Book room")}</span><select onChange={(event) => setImportTargetBookId(event.target.value || null)} value={importTargetBookId ?? ""}><option value="">{t("暂不归档", "Leave unfiled")}</option>{libraryBooks.map((book) => <option key={book.id} value={book.id}>{formatBookTitle(book.title, uiLanguage)}</option>)}</select></label>
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
                  <strong>{t("选择文件，或把文件拖到这里", "Choose a file or drop it here")}</strong>
                  <small>{t("支持 EPUB、PDF、TXT、Markdown；默认最大 50 MB。不会修改你的原始文件。", "Supports EPUB, PDF, TXT, and Markdown up to 50 MB by default. Your original file is never modified.")}</small>
                </label>
                <div className="import-list-heading"><div><h4>{t("已导入资料", "Imported sources")}</h4><p>{t("资料可以随时重新归档，导入完成后可直接进入对应书房聊天。", "Sources can be reassigned at any time, and you can enter the related book room as soon as import finishes.")}</p></div><div className="document-filter"><button className={documentFilter === "all" ? "active" : ""} onClick={() => setDocumentFilter("all")} type="button">{t("全部", "All")} {documents.length}</button><button className={documentFilter === "unfiled" ? "active" : ""} onClick={() => setDocumentFilter("unfiled")} type="button">{t("待归档", "Unfiled")} {documents.filter((document) => !document.book_id).length}</button></div></div>
                <div className="import-document-list">
                  {visibleImportDocuments.length === 0 && <p className="empty-library">{t("这里还没有符合条件的资料。可以先导入一个版本，或在“先建一本书”中创建书房。", "No matching sources are here yet. Import an edition, or create a book room first.")}</p>}
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
                        <span><strong>{document.name}</strong><small>{libraryBooks.find((book) => book.id === document.book_id)?.title ?? t("待归档", "Unfiled")} · {document.chunk_count} {t("个片段", "chunks")} · {formatBytes(document.size_bytes)}</small></span>
                      </button>
                      <select aria-label={t(`调整《${document.name}》的归属`, `Change the assignment for ${document.name}`)} className="document-assignment" disabled={setupPending} onChange={(event) => reassignDocument(document, event.target.value)} value={document.book_id ?? ""}><option value="">{t("待归档", "Unfiled")}</option>{libraryBooks.map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}</select>
                      <button className="document-delete" onClick={() => removeDocument(document)} type="button">{t("删除", "Delete")}</button>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {importTab === "notes" && (
              <section className="import-stage">
                <div className="import-stage-heading">
                  <div><p className="overline">{t("阅读记录", "Reading capture")}</p><h3>{t("先留下让你停住的地方", "Keep the place that made you pause")}</h3></div>
                  <label className="import-target"><span>{t("留给哪本书", "Save to")}</span><select disabled={libraryBooks.length === 0} onChange={(event) => setImportTargetBookId(event.target.value || null)} value={importTargetBookId ?? ""}><option value="">{t("选择一本书", "Choose a book")}</option>{libraryBooks.map((book) => <option key={book.id} value={book.id}>{formatBookTitle(book.title, uiLanguage)}</option>)}</select></label>
                </div>
                {libraryBooks.length === 0 ? <p className="empty-library">{t("阅读痕迹需要有一个书房。请先在“先建一本书”中添加书目；没有电子书也完全可以。", "A reading trace needs a book room. Create the book first; an ebook file is not required.")}</p> : (
                  <form className="import-note-form" onSubmit={(event) => captureReadingNote(event, importTargetBookId)}>
                    <label><span>{t("类型", "Type")}</span><select defaultValue="reflection" name="kind">{(Object.keys(readingNoteKindLabels) as ReadingNoteKind[]).map((kind) => <option key={kind} value={kind}>{readingNoteKindLabels[kind]}</option>)}</select></label>
                    <label><span>{t("位置", "Location")}</span><input name="locator" placeholder={t("可选：第三章、页码、进度", "Optional: chapter, page, or progress")} /></label>
                    <label className="import-note-wide"><span>{t("原文或划线", "Quote or highlight")}</span><textarea name="quote" placeholder={t("可选；没有原文也没关系", "Optional; your own words are enough")} /></label>
                    <label className="import-note-wide"><span>{t("你的想法", "Your thought")}</span><textarea name="content" placeholder={t("写下你想继续聊的判断、感受或问题……", "Write the judgment, feeling, or question you want to continue...")} required /></label>
                    <button disabled={setupPending || !importTargetBookId} type="submit">{t("保存到书房", "Save to book room")}</button>
                  </form>
                )}
              </section>
            )}

            {importTab === "books" && (
              <section className="import-stage">
                <div className="import-stage-heading"><div><p className="overline">{t("先有书房，再有文件", "A room before a file")}</p><h3>{t("先为一本书留出位置", "Make room for a book first")}</h3><p>{t("实体书、阅读 App 里的书，或只剩印象的作品，都可以先建立书房。", "A print book, a title in a reading app, or even a work you only remember can have a room before it has a file.")}</p></div></div>
                <form className="import-book-form" onSubmit={createLibraryBook}>
                  <label><span>{t("书名", "Title")}</span><input onChange={(event) => setNewBookTitle(event.target.value)} placeholder={t("例如：《局外人》", "For example: The Stranger")} value={newBookTitle} /></label>
                  <label><span>{t("作者", "Author")}</span><input onChange={(event) => setNewBookAuthor(event.target.value)} placeholder={t("可选", "Optional")} value={newBookAuthor} /></label>
                  <label><span>{t("阅读状态", "Reading status")}</span><select onChange={(event) => setNewBookStatus(event.target.value as ReadingStatus)} value={newBookStatus}>{(Object.keys(readingStatusLabels) as ReadingStatus[]).map((status) => <option key={status} value={status}>{readingStatusLabels[status]}</option>)}</select></label>
                  <button disabled={setupPending || !newBookTitle.trim()} type="submit">{t("建立书房", "Create book room")}</button>
                </form>
                <p className="import-assurance">{t("建立书房不会要求上传文件。之后可继续导入版本、保存阅读痕迹，或直接开始聊天。", "Creating a room never requires a file. Add editions or reading traces later, or simply start talking.")}</p>
              </section>
            )}

            <p className="import-status" aria-live="polite">{setupStatus}</p>
          </section>
        </div>
      )}

      {showPreferences && (
        <div className="setup-backdrop" role="presentation" onMouseDown={() => setShowPreferences(false)}>
          <section
            aria-label={t("偏好与模型", "Preferences and models")}
            aria-modal="true"
            className="preferences-drawer"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="setup-heading">
              <div>
                <p className="overline">{t("你的空间，由你选择", "Your space, your choice")}</p>
                <h2>{t("偏好与模型", "Preferences & models")}</h2>
              </div>
              <button aria-label={t("关闭偏好与模型", "Close preferences and models")} onClick={() => setShowPreferences(false)} type="button">×</button>
            </div>

            <p className="privacy-callout">
              {t("这是你的个人设置，与书架和阅读痕迹分开。使用远程模型时，当轮需要的内容会发送给你选择的服务。", "These are personal preferences, separate from your library and reading traces. When you use a remote model, the context needed for that turn is sent to the service you chose.")}
            </p>

            <form className="reader-profile-form" onSubmit={saveReaderProfile}>
              <div className="setup-section-title">
                <span>01</span><div><h3>{t("你的称呼", "Your name")}</h3><p>{t("它只会显示在这台设备的界面中。", "It is shown only in the interface on this device.")}</p></div>
              </div>
              <label>
                <span>{t("界面称呼", "Display name")}</span>
                <input
                  maxLength={80}
                  onChange={(event) => setReaderDisplayName(event.target.value)}
                  placeholder={t("例如：小林", "For example: Lin")}
                  value={readerDisplayName}
                />
              </label>
              <div className="setup-actions">
                <button className="model-save" disabled={setupPending} type="submit">{t("保存", "Save")}</button>
              </div>
            </form>

            <div className="model-profile-manager">
              <div className="setup-section-title">
                <span>02</span><div><h3>{t("书友模型", "Book-friend models")}</h3><p>{t("选择这次想使用的模型；每次对话都可以换一个声音。", "Choose the model for this conversation. You can change it whenever you want.")}</p></div>
              </div>
              <div className="model-profile-list">
                {modelSettings.model && (
                  <article className={!selectedModelProfileId ? "selected" : ""}>
                    <button className="model-profile-select" onClick={() => setSelectedModelProfileId(null)} type="button">
                      <span className="model-profile-mark">AI</span>
                      <span>
                        <strong>{modelNameForDisplay(modelSettings.model, uiLanguage)}</strong>
                        <small>{t("已准备好，可直接开始。", "Ready to use.")}</small>
                      </span>
                    </button>
                    <div className="model-profile-actions">
                      {!selectedModelProfileId && <span>{t("正在使用", "In use")}</span>}
                      <button disabled={setupPending || !modelSettings.base_url} onClick={testEnvironmentModel} type="button">{t("试一试", "Test")}</button>
                    </div>
                  </article>
                )}
                {!modelSettings.model && modelProfiles.length === 0 && <p className="empty-library">{t("还没有可用模型。添加一个后，泊舟就能开始回应。", "No model is available yet. Add one so BookMate can respond.")}</p>}
                {modelProfiles.map((profile) => (
                  <article className={selectedModelProfileId === profile.id ? "selected" : ""} key={profile.id}>
                    <button className="model-profile-select" onClick={() => setSelectedModelProfileId(profile.id)} type="button">
                      <span className="model-profile-mark">AI</span>
                      <span>
                        <strong>{profileNameForDisplay(profile, uiLanguage)}</strong>
                        <small>{profile.is_default ? t("新对话默认使用", "Default for new conversations") : t("可用于本轮对话", "Available for this conversation")}</small>
                      </span>
                    </button>
                    <div className="model-profile-actions">
                      <button disabled={setupPending} onClick={() => beginModelProfileEdit(profile)} type="button">{t("编辑", "Edit")}</button>
                      {selectedModelProfileId === profile.id ? <span>{t("正在使用", "In use")}</span> : profile.is_default ? <span>{t("新对话默认", "Default")}</span> : <button disabled={setupPending} onClick={() => setDefaultModelProfile(profile)} type="button">{t("设为默认", "Make default")}</button>}
                      <button disabled={setupPending} onClick={() => testModelProfile(profile)} type="button">{t("试一试", "Test")}</button>
                      <button disabled={setupPending} onClick={() => removeModelProfile(profile)} type="button">{t("移除", "Remove")}</button>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <form className="model-form" onSubmit={saveModelProfile}>
              <div className="setup-section-title">
                <span>03</span><div><h3>{editingModelProfileId ? t("编辑模型", "Edit model") : t("添加模型", "Add model")}</h3><p>{t("给它起一个在聊天时一眼能认出的名字。", "Give it a name you can recognize at a glance while chatting.")}</p></div>
              </div>
              <label>
                <span>{t("显示名称", "Display name")}</span>
                <input
                  onChange={(event) => setModelProfileName(event.target.value)}
                  placeholder={t("例如：深度交谈 / 本地轻聊", "For example: Deep reading / Local quick chat")}
                  value={modelProfileName}
                />
              </label>
              <label>
                <span>{t("服务类型", "Service type")}</span>
                <select
                  onChange={(event) => setModelDraft({ ...modelDraft, protocol: event.target.value as ModelProtocol })}
                  value={modelDraft.protocol}
                >
                  <option value="chat_completions">{t("通用兼容", "OpenAI-compatible")}</option>
                  <option value="responses">Responses</option>
                </select>
              </label>
              <label>
                <span>{t("服务地址", "Base URL")}</span>
                <input
                  onChange={(event) => setModelDraft({ ...modelDraft, base_url: event.target.value })}
                  placeholder={t("例如：http://127.0.0.1:11434/v1", "For example: http://127.0.0.1:11434/v1")}
                  type="url"
                  value={modelDraft.base_url}
                />
              </label>
              <label>
                <span>{t("模型名称", "Model name")}</span>
                <input
                  onChange={(event) => setModelDraft({ ...modelDraft, model: event.target.value })}
                  placeholder={t("例如：qwen3.5:4b", "For example: qwen3.5:4b")}
                  value={modelDraft.model}
                />
              </label>
              <label>
                <span>{t("访问密钥", "API key")} {modelDraft.api_key_configured && <em>{t("已保存", "Saved")}</em>}</span>
                <input
                  autoComplete="off"
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={modelDraft.api_key_configured ? t("留空则保持现有密钥", "Leave blank to keep the existing key") : t("本地服务通常可留空", "Usually blank for local services")}
                  type="password"
                  value={apiKey}
                />
              </label>
              <div className="setup-actions">
                {editingModelProfileId && <button disabled={setupPending} onClick={cancelModelProfileEdit} type="button">{t("取消", "Cancel")}</button>}
                <button className="model-save" disabled={setupPending || !modelDraft.base_url || !modelDraft.model} type="submit">{editingModelProfileId ? t("保存修改", "Save changes") : t("保存模型", "Save model")}</button>
              </div>
            </form>

            <p className="setup-status" aria-live="polite">{setupStatus}</p>
          </section>
        </div>
      )}

      {showLocalSetup && (
        <div className="setup-backdrop" role="presentation" onMouseDown={() => setShowLocalSetup(false)}>
          <section
            aria-label={t("本地书库", "Local library")}
            aria-modal="true"
            className="setup-drawer"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="setup-heading">
              <div>
                <p className="overline">{t("你的本地图书馆", "Your local library")}</p>
                <h2>{t("管理你的本地书库", "Manage your local library")}</h2>
              </div>
              <button aria-label={t("关闭本地书库", "Close local library")} onClick={() => setShowLocalSetup(false)} type="button">×</button>
            </div>

            <p className="privacy-callout">
              {t("书籍、阅读痕迹、文件与索引都保存在本机。模型连接及个人界面配置在左下角的“偏好与模型设置”中单独管理。", "Books, reading traces, files, and indexes stay on this device. Model connections and interface preferences are managed separately under Preferences & models.")}
            </p>

            <div className="library-shelf-manager">
              <div className="setup-section-title">
                <span>01</span><div><h3>{t("我的书架", "My shelf")}</h3><p>{t("作品独立于文件、笔记和对话存在", "A book exists independently of its files, notes, and conversations")}</p></div>
              </div>
              <button className="library-import-link" onClick={() => { setShowLocalSetup(false); setShowImportCenter(true); setImportTab("books"); }} type="button">{t("导入一本书、资料或阅读痕迹", "Import a book, source, or reading trace")} <span>↗</span></button>
              <div className="shelf-list">
                {libraryBooks.length === 0 && <p className="empty-library">{t("先添加一本书；之后可以为它绑定多个版本、笔记和资料。", "Add a book first. You can attach multiple editions, notes, and sources later.")}</p>}
                {libraryBooks.map((book) => (
                  <article className={selectedLibraryBookId === book.id ? "selected" : ""} key={book.id}>
                    <button className="shelf-select" onClick={() => selectLibraryBook(book)} type="button">
                      <span className="shelf-spine">{book.title.slice(0, 1)}</span>
                      <span><strong>{book.title}</strong><small>{book.author ?? t("作者待补充", "Author not added")} · {book.note_count} {t("条阅读痕迹", "reading traces")} · {book.document_count} {t("份资料", "sources")}</small></span>
                    </button>
                    <select
                      aria-label={t(`更新《${book.title}》的阅读状态`, `Update reading status for ${book.title}`)}
                      onChange={(event) => updateReadingStatus(book, event.target.value as ReadingStatus)}
                      value={book.reading_status}
                    >
                      {(Object.keys(readingStatusLabels) as ReadingStatus[]).map((status) => (
                        <option key={status} value={status}>{readingStatusLabels[status]}</option>
                      ))}
                    </select>
                    <button className="document-delete" onClick={() => removeLibraryBook(book)} type="button">{t("移除", "Remove")}</button>
                  </article>
                ))}
              </div>
            </div>

            <div className="book-room-manager">
              <div className="setup-section-title">
                <span>02</span><div><h3>{t("这本书，怎样陪你聊", "How this book should meet you")}</h3><p>{t("不上传全文，也可以先设定书房与剧透边界", "Set the room and spoiler boundary even without a full text")}</p></div>
              </div>
              {!selectedLibraryBook && <p className="empty-library">{t("先在书架中选择一本书。实体书、阅读 App 里的书和只有读后印象的书都可以。", "Choose a book from the shelf. Print books, titles in reading apps, and books you only remember are all welcome.")}</p>}
              {selectedLibraryBook && (
                <form className="book-room-form" key={selectedLibraryBook.id} onSubmit={saveBookRoomSettings}>
                  <label><span>{t("ISBN / 条码", "ISBN / barcode")}</span><input defaultValue={selectedLibraryBook.isbn ?? ""} name="isbn" placeholder={t("可手动输入，扫码入口将随后加入", "Enter it manually; scanning will follow later")} /></label>
                  <label><span>{t("我读到", "My progress")}</span><input defaultValue={selectedLibraryBook.reading_progress ?? ""} name="reading_progress" placeholder={t("例如：第三章、58%、已读完", "For example: Chapter 3, 58%, finished")} /></label>
                  <label><span>{t("剧透边界", "Spoiler boundary")}</span><select defaultValue={selectedLibraryBook.spoiler_policy} name="spoiler_policy">{(Object.keys(spoilerPolicyLabels) as SpoilerPolicy[]).map((policy) => <option key={policy} value={policy}>{spoilerPolicyLabels[policy]}</option>)}</select></label>
                  <label><span>{t("书友姿态", "Companion stance")}</span><select defaultValue={selectedLibraryBook.companion_stance} name="companion_stance">{(Object.keys(companionStanceLabels) as CompanionStance[]).map((stance) => <option key={stance} value={stance}>{companionStanceLabels[stance]}</option>)}</select></label>
                  <label className="book-room-intent"><span>{t("这次想聊什么", "What do you want from this room?")}</span><textarea defaultValue={selectedLibraryBook.room_intent ?? ""} name="room_intent" placeholder={t("例如：别急着总结，帮我把我对结局的抵触说清楚。", "For example: Do not rush to summarize; help me understand my resistance to the ending.")} /></label>
                  <button disabled={setupPending} type="submit">{t("保存书房规则", "Save room preferences")}</button>
                </form>
              )}
            </div>

            <div className="reading-capture-manager">
              <div className="setup-section-title">
                <span>03</span><div><h3>{t("随手留下阅读痕迹", "Keep a reading trace")}</h3><p>{t("一段摘录、一句感想或一个问题，就足够开始", "A quote, reflection, or question is enough to begin")}</p></div>
              </div>
              {!selectedLibraryBook && <p className="empty-library">{t("选择书架项目后，可以粘贴阅读 App 的划线，或记下实体书中让你停住的地方。", "Choose a shelf item, then paste a highlight from a reading app or note the place that stopped you in a print book.")}</p>}
              {selectedLibraryBook && (
                <>
                  <form className="reading-capture-form" onSubmit={captureReadingNote}>
                    <select defaultValue="reflection" name="kind">
                      {(Object.keys(readingNoteKindLabels) as ReadingNoteKind[]).map((kind) => <option key={kind} value={kind}>{readingNoteKindLabels[kind]}</option>)}
                    </select>
                    <input name="locator" placeholder={t("位置（可选）：第三章、页码、进度", "Location (optional): chapter, page, progress")} />
                    <textarea name="quote" placeholder={t("原文或划线（可选；没有也完全可以）", "Quote or highlight (optional)")} />
                    <textarea name="content" placeholder={t("你想留下什么？例如：我不同意大家把这里理解成宽恕。", "What do you want to keep? For example: I disagree that this passage is about forgiveness.")} required />
                    <button disabled={setupPending} type="submit">{t("留在这本书里", "Save to this book")}</button>
                  </form>
                  <div className="reading-note-list">
                    {readingNotes.length === 0 && <p className="empty-library">{t("还没有阅读痕迹。你不需要整理好才开始聊。", "No reading traces yet. You do not need to organize your thoughts before talking.")}</p>}
                    {readingNotes.map((note) => (
                      <article key={note.id}>
                        <span>{readingNoteKindLabels[note.kind]}</span>
                        <div>{note.quote && <blockquote>{note.quote}</blockquote>}<p>{note.content}</p>{note.locator && <small>{note.locator}</small>}</div>
                        <button aria-label={t("删除阅读痕迹", "Delete reading trace")} className="document-delete" onClick={() => removeReadingNote(note)} type="button">{t("删除", "Delete")}</button>
                      </article>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="library-manager">
              <div className="setup-section-title">
                <span>04</span><div><h3>{t("版本与资料", "Editions & sources")}</h3><p>{t("导入、重新归档与批量查看都在独立工作台中完成", "Import, reassign, and review sources in the dedicated workspace")}</p></div>
              </div>
              <button className="library-import-link" onClick={() => { setShowLocalSetup(false); setShowImportCenter(true); setImportTab("files"); }} type="button">{t(`打开导入中心管理 ${documents.length} 份本地资料`, `Open Import Center · ${documents.length} local sources`)} <span>↗</span></button>
            </div>

            <p className="setup-status" aria-live="polite">{setupStatus}</p>
          </section>
        </div>
      )}

      <section className={`workspace ${showRecommendations ? "recommendations-open" : ""}`}>
        <aside className="companion-panel reveal reveal-two">
          <div className="companion-profile">
            <div className="portrait-wrap">
              <div className="portrait">{t("舟", "B")}</div>
              <span className="ai-label">AI</span>
            </div>
            <div>
              <p className="overline">{t("你的私人 AI 书友", "Your private AI book friend")}</p>
              <h1>{t("泊舟", "BookMate")}</h1>
              <p className="identity-copy">{t("在这里，继续那些还没说完的话。", "Continue the conversations that are not finished yet.")}</p>
            </div>
          </div>

          <button
            className="new-conversation-button"
            onClick={() => switchMode(mode, mode === "book_room" ? activeBookTitle : undefined)}
            type="button"
          >
            <span>＋</span>
            {t("开始新的对话", "New conversation")}
          </button>

          <nav className="companion-nav" aria-label={t("书友空间导航", "BookMate navigation")}>
            <p className="companion-nav-label">{t("此刻", "Now")}</p>
            <button
              className={mode === "book_room" ? "active" : ""}
              onClick={() => {
                if (mode === "book_room") composerRef.current?.focus();
                else switchMode("book_room", activeBookTitle);
              }}
              type="button"
            >
              <span className="companion-nav-mark">{t("书", "B")}</span>
              <span><strong>{formatBookTitle(activeBookDisplayTitle, uiLanguage)}</strong><small>{t("当前书房", "Current book room")}</small></span>
            </button>
            <button
              className={mode === "general_companion" ? "active" : ""}
              onClick={() => mode === "general_companion" ? composerRef.current?.focus() : switchMode("general_companion")}
              type="button"
            >
              <span className="companion-nav-mark">{t("谈", "C")}</span>
              <span><strong>{t("广泛书友", "Open conversation")}</strong><small>{t("跨越书与生活", "Across books and life")}</small></span>
            </button>

            <p className="companion-nav-label">{t("我的阅读", "My reading")}</p>
            <button onClick={() => setShowLocalSetup(true)} type="button">
              <span className="companion-nav-mark">{t("藏", "L")}</span>
              <span><strong>{t("私人书库", "Private library")}</strong><small>{libraryBooks.length} {t("本书", "books")}</small></span>
            </button>
            <button onClick={() => setShowImportCenter(true)} type="button">
              <span className="companion-nav-mark">{t("入", "I")}</span>
              <span><strong>{t("导入阅读", "Import reading")}</strong><small>{documents.length} {t("份本地资料", "local sources")}</small></span>
            </button>
            <button onClick={() => setShowRelationship(true)} type="button">
              <span className="companion-nav-mark">{t("忆", "M")}</span>
              <span><strong>{t("对话与记忆", "Conversations & memory")}</strong><small>{memories.filter((memory) => memory.status === "confirmed").length} {t("条由你确认", "confirmed by you")}</small></span>
            </button>
          </nav>

          <div className="companion-panel-footer">
            <p className="local-trust"><i />{t("本地保存，只记住你确认的事", "Stored locally. Only confirmed memories remain.")}</p>
            <button className="preferences-entry" onClick={() => setShowPreferences(true)} type="button">
              <span className="preferences-entry-mark">{t("设", "S")}</span>
              <span>
                <strong>{t("偏好与模型", "Preferences & models")}</strong>
                <small>{readerProfile.display_name
                  ? t(`${readerProfile.display_name} · 个人设置`, `${readerProfile.display_name} · Personal settings`)
                  : t("称呼、模型与隐私边界", "Name, models & privacy")}</small>
              </span>
              <b>›</b>
            </button>
          </div>
        </aside>

        <section className={`conversation-panel reveal reveal-three ${messages.length <= 1 ? "conversation-empty" : "conversation-active"}`}>
          <div className="book-heading">
            <div>
              <p className="overline">{mode === "book_room" ? t("此刻共同谈论", "In this book room") : t("开放书友空间", "Open conversation")}</p>
              <h2>{mode === "book_room" ? formatBookTitle(activeBookDisplayTitle, uiLanguage) : t("从你的问题出发", "Begin with your question")}</h2>
              <p>{mode === "book_room"
                ? (activeDocument
                  ? t("你的本地资料 · 按需取证", "Your local sources · cited when helpful")
                  : t("沿着你的阅读继续", "Continue from your reading"))
                : t("不绑定书籍 · 跨作品、生活与思想", "Across books, life, and ideas")}</p>
            </div>
            <div className="book-heading-actions">
              <div className="mode-switch" aria-label={t("选择书友模式", "Choose conversation mode")}>
                <button
                  className={mode === "general_companion" ? "active" : ""}
                  onClick={() => switchMode("general_companion")}
                  type="button"
                >{t("广泛书友", "Open chat")}</button>
                <button
                  className={mode === "book_room" ? "active" : ""}
                  onClick={() => switchMode("book_room")}
                  type="button"
                >{t("本书房间", "Book room")}</button>
              </div>
              <button
                aria-expanded={showRecommendations}
                className="next-book-button"
                onClick={() => setShowRecommendations((current) => !current)}
                type="button"
              >{showRecommendations ? t("收起书单", "Close reading paths") : t("下一本", "What to read next")}</button>
            </div>
          </div>

          <div className="conversation-body">
            <div className={`conversation-stream ${messages.length <= 1 ? "conversation-welcome" : ""}`} aria-live="polite" ref={conversationStreamRef}>
              {messages.map((message) => (
                <article className={`message message-${message.role}`} key={message.id}>
                  {message.role === "companion" && (
                    <div className="message-meta">
                      <span>{t("泊舟", "BookMate")}</span>
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
                      {message.errorAction === "settings" ? t("检查书友模型", "Check model settings") : t("重新发送", "Send again")}
                    </button>
                  )}
                  {message.role === "companion" && message.memoryId && message.memoryText && (
                    <div className="memory-candidate">
                      <span>{t("是否记住：", "Remember this? ")}{message.memoryText}</span>
                      <button onClick={() => confirmMemory({
                        id: message.memoryId!, conversation_id: conversationId ?? "", scope: mode === "book_room" ? "book" : "global", book_title: activeBookTitle, content: message.memoryText!, status: "pending", created_at: "",
                      })} type="button">{t("记住", "Remember")}</button>
                      <button onClick={() => removeMemory({
                        id: message.memoryId!, conversation_id: conversationId ?? "", scope: mode === "book_room" ? "book" : "global", book_title: activeBookTitle, content: message.memoryText!, status: "pending", created_at: "",
                      })} type="button">{t("先不记", "Not now")}</button>
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
                <div className="thinking"><i /><i /><i /><span>{t("泊舟正在想怎样接住这句话", "BookMate is considering how to meet this thought")}</span></div>
              )}
            </div>

            <div className="composer-wrap">
              <form className="composer" onSubmit={submitMessage}>
                <textarea
                  aria-label={t("说说你读完后的想法", "Share what stayed with you after reading")}
                  maxLength={4000}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder={mode === "book_room"
                    ? t("不必整理好。说说那句还留在心里的话……", "No need to organize it. Start with the thought that stayed with you...")
                    : t("从一个困惑、判断，或最近挥之不去的念头开始……", "Begin with a question, a judgment, or a thought that keeps returning...")}
                  ref={composerRef}
                  rows={1}
                  value={input}
                />
                <div className="composer-footer">
                  <div className="composer-tools">
                    <div className="direction-tabs" aria-label={t("选择谈话方向", "Choose a conversation direction")}>
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
                      <span>{t("模型", "Model")}</span>
                      <select aria-label={t("选择本轮聊天模型", "Choose the model for this conversation")} onChange={(event) => setSelectedModelProfileId(event.target.value || null)} value={selectedModelProfileId ?? ""}>
                        <option value="">{modelSettings.model ? modelNameForDisplay(modelSettings.model, uiLanguage) : t("暂未选择模型", "No model selected")}</option>
                        {modelProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profileNameForDisplay(profile, uiLanguage)}{profile.is_default ? t("（默认）", " (default)") : ""}</option>)}
                      </select>
                      <button onClick={() => setShowPreferences(true)} type="button">{t("管理", "Manage")}</button>
                    </label>
                  </div>
                  <button disabled={!input.trim() || pending} type="submit">
                    <span className="submit-label-full">{pending ? t("正在回应", "Responding") : t("交给泊舟", "Send to BookMate")}</span>
                    <span className="submit-label-short">{pending ? t("回应中", "Replying") : t("发送", "Send")}</span>
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
              <p className="overline">{t("下一本", "Read next")}</p>
              <h2>{t("沿着此刻的共鸣", "Follow this resonance")}</h2>
            </div>
            <button aria-label={t("关闭下一本书单", "Close reading paths")} className="recommendation-close" onClick={() => setShowRecommendations(false)} type="button">{t("收起", "Close")}</button>
          </div>
          <p className="recommendation-intro">
            {t("不是榜单。泊舟从延续、反面与跨越三个方向，各留下一本。", "Not a ranking. BookMate leaves one book along each of three paths: continuation, counterpoint, and crossing over.")}
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
                  <summary>{t("为什么可能不适合", "Why it may not fit")}</summary>
                  <p>{item.book.caution}</p>
                </details>
                <button onClick={() => startRecommendationConversation(item)} type="button">
                  {t("带着一个问题进入", "Enter with a question")} <span>↗</span>
                </button>
              </article>
            ))}
          </div>

          <button className="different-button" onClick={changeRecommendationDirection} type="button">
            {showAlternativeRecommendations
              ? t("回到原来的三种邀请", "Return to the first three paths")
              : t("给我完全不同的东西", "Show me something entirely different")}
          </button>
          <p className="commercial-note">{t("推荐排序不读取价格或佣金。", "Recommendations do not use prices or commissions.")}</p>
        </aside>
      </section>
    </main>
  );
}

function flowMoveLabel(move: string, language: UiLanguage): string {
  const labels: Record<string, [string, string]> = {
    listen: ["倾听", "Listening"],
    mirror: ["映照", "Reflecting"],
    tension: ["形成张力", "Finding tension"],
    connect: ["连接生活", "Connecting to life"],
  };
  const label = labels[move] ?? ["共同思考", "Thinking together"];
  return localize(language, label[0], label[1]);
}

function messageMoveForDisplay(move: string, language: UiLanguage): string {
  const labels: Record<string, [string, string]> = {
    "邀请": ["邀请", "Invitation"],
    Invitation: ["邀请", "Invitation"],
    "稍后再试": ["稍后再试", "Try again"],
    "Try again": ["稍后再试", "Try again"],
    "倾听": ["倾听", "Listening"],
    Listening: ["倾听", "Listening"],
    "映照": ["映照", "Reflecting"],
    Reflecting: ["映照", "Reflecting"],
    "形成张力": ["形成张力", "Finding tension"],
    "Finding tension": ["形成张力", "Finding tension"],
    "连接生活": ["连接生活", "Connecting to life"],
    "Connecting to life": ["连接生活", "Connecting to life"],
    "共同思考": ["共同思考", "Thinking together"],
    "Thinking together": ["共同思考", "Thinking together"],
  };
  const label = labels[move];
  return label ? localize(language, label[0], label[1]) : move;
}

function searchDecisionNote(action: string | undefined, language: UiLanguage): string | undefined {
  const notes: Record<string, [string, string]> = {
    disabled: ["这轮涉及动态信息，但你已关闭联网；泊舟不会绕过设置搜索。", "This question involves current information, but web access is off. BookMate will respect that choice."],
    permission_required: ["联网会提高准确性；当前是“先问我”，泊舟会先征得你的同意。", "Web access could improve accuracy. BookMate will ask before searching."],
    would_search: ["这轮会使用你已允许的联网来源，并在回答中说明。", "BookMate will use the web access you allowed and disclose it in the response."],
  };
  const note = action ? notes[action] : undefined;
  return note ? localize(language, note[0], note[1]) : undefined;
}

function memoryScopeLabel(scope: MemoryScope, language: UiLanguage): string {
  const labels: Record<MemoryScope, [string, string]> = {
    global: ["跨书线索", "Across books"],
    book: ["本书线索", "This book"],
    session: ["仅此会话", "This conversation only"],
  };
  return localize(language, labels[scope][0], labels[scope][1]);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
