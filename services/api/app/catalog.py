from .models import Book, RecommendationLane


BOOKS: dict[str, Book] = {
    "the-stranger": Book(
        id="the-stranger",
        title="局外人",
        author="阿尔贝·加缪",
        year=1942,
        description="从一个拒绝按社会期待表达感情的人出发，追问荒诞、诚实与道德判断。",
        tags=["真实", "孤独", "荒诞", "道德选择"],
        lane_hint=RecommendationLane.CONTINUE,
        caution="冷峻的叙事可能让期待情感抚慰的读者感到疏离。",
        entry_question="不配合社会期待，究竟是诚实，还是另一种逃避？",
    ),
    "siddhartha": Book(
        id="siddhartha",
        title="悉达多",
        author="赫尔曼·黑塞",
        year=1922,
        description="不把答案交给教义，而是在经验、欲望和失去中寻找属于自己的道路。",
        tags=["真实", "自我", "孤独", "精神成长"],
        lane_hint=RecommendationLane.CONTINUE,
        caution="它的寓言感和精神性未必适合希望看到严密论证的读者。",
        entry_question="有些理解是否只能活过，而无法被别人教会？",
    ),
    "notes-from-underground": Book(
        id="notes-from-underground",
        title="地下室手记",
        author="陀思妥耶夫斯基",
        year=1864,
        description="把自我诚实推到令人不适的位置，暴露自由、怨恨和自我破坏的纠缠。",
        tags=["孤独", "自由", "自我欺骗", "反理性"],
        lane_hint=RecommendationLane.COUNTERPOINT,
        caution="叙述者尖刻而反复，阅读体验故意令人不舒服。",
        entry_question="一个人拒绝所有解释时，他更自由了，还是更被自己困住？",
    ),
    "ethics-of-ambiguity": Book(
        id="ethics-of-ambiguity",
        title="模糊性的道德",
        author="西蒙娜·德·波伏瓦",
        year=1947,
        description="从存在主义出发，讨论个人自由为何不能脱离他人的自由。",
        tags=["自由", "责任", "道德选择", "他者"],
        lane_hint=RecommendationLane.COUNTERPOINT,
        caution="哲学论述密度较高，需要慢读和反复澄清概念。",
        entry_question="只忠于自己的真实，是否已经足以构成一种道德？",
    ),
    "mans-search-for-meaning": Book(
        id="mans-search-for-meaning",
        title="活出生命的意义",
        author="维克多·弗兰克尔",
        year=1946,
        description="从极端处境与心理实践转向意义、选择和一个人对生命的回应。",
        tags=["意义", "责任", "苦难", "心理"],
        lane_hint=RecommendationLane.CROSSOVER,
        caution="涉及集中营经历与苦难，可能触发沉重情绪；也不应把它简化为励志读物。",
        entry_question="意义是被发现的，还是人在回应处境时创造的？",
    ),
    "the-art-of-loving": Book(
        id="the-art-of-loving",
        title="爱的艺术",
        author="艾里希·弗洛姆",
        year=1956,
        description="把爱从被动感受转向能力、实践和对他人的责任。",
        tags=["关系", "责任", "心理", "自我"],
        lane_hint=RecommendationLane.CROSSOVER,
        caution="部分社会判断带有作者时代印记，适合批判性阅读。",
        entry_question="真实做自己与真正看见别人之间，是否存在冲突？",
    ),
}


def get_book(book_id: str) -> Book:
    return BOOKS.get(book_id, BOOKS["the-stranger"])

