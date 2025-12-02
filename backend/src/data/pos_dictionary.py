"""
Lightweight POS (Part-of-Speech) Dictionary for English
Used to improve lemmatization accuracy without heavy NLP processing

Format: {word_lower: pos_tag}
POS tags: 'n' (noun), 'v' (verb), 'a' (adjective), 'r' (adverb)
"""

# Common verbs that get mislemmatized without POS
POS_DICTIONARY = {
    # Common verbs (present participle/gerunds)
    "running": "v", "walking": "v", "talking": "v", "looking": "v", "making": "v",
    "taking": "v", "going": "v", "coming": "v", "saying": "v", "getting": "v",
    "working": "v", "thinking": "v", "feeling": "v", "seeing": "v", "knowing": "v",
    "trying": "v", "using": "v", "finding": "v", "giving": "v", "telling": "v",
    "asking": "v", "leaving": "v", "calling": "v", "moving": "v", "living": "v",
    "playing": "v", "helping": "v", "showing": "v", "hearing": "v", "reading": "v",
    "writing": "v", "standing": "v", "sitting": "v", "holding": "v", "bringing": "v",
    "beginning": "v", "running": "v", "keeping": "v", "starting": "v", "growing": "v",
    "opening": "v", "closing": "v", "following": "v", "learning": "v", "changing": "v",

    # Common verbs (past tense/past participle)
    "ran": "v", "walked": "v", "talked": "v", "looked": "v", "made": "v",
    "took": "v", "went": "v", "came": "v", "said": "v", "got": "v",
    "worked": "v", "thought": "v", "felt": "v", "saw": "v", "knew": "v",
    "tried": "v", "used": "v", "found": "v", "gave": "v", "told": "v",
    "asked": "v", "left": "v", "called": "v", "moved": "v", "lived": "v",
    "played": "v", "helped": "v", "showed": "v", "heard": "v", "read": "v",
    "wrote": "v", "stood": "v", "sat": "v", "held": "v", "brought": "v",
    "began": "v", "kept": "v", "started": "v", "grew": "v", "changed": "v",
    "opened": "v", "closed": "v", "followed": "v", "learned": "v",

    # Common verbs (3rd person singular)
    "runs": "v", "walks": "v", "talks": "v", "looks": "v", "makes": "v",
    "takes": "v", "goes": "v", "comes": "v", "says": "v", "gets": "v",
    "works": "v", "thinks": "v", "feels": "v", "sees": "v", "knows": "v",
    "tries": "v", "uses": "v", "finds": "v", "gives": "v", "tells": "v",
    "asks": "v", "leaves": "v", "calls": "v", "moves": "v", "lives": "v",
    "plays": "v", "helps": "v", "shows": "v", "hears": "v", "reads": "v",
    "writes": "v", "stands": "v", "sits": "v", "holds": "v", "brings": "v",
    "begins": "v", "keeps": "v", "starts": "v", "grows": "v", "changes": "v",

    # Specific problematic verbs
    "insults": "v", "insult": "v", "insulting": "v", "insulted": "v",
    "loves": "v", "loving": "v", "loved": "v",
    "hates": "v", "hating": "v", "hated": "v",
    "wants": "v", "wanting": "v", "wanted": "v",
    "needs": "v", "needing": "v", "needed": "v",
    "believes": "v", "believing": "v", "believed": "v",
    "understands": "v", "understanding": "v", "understood": "v",
    "remembers": "v", "remembering": "v", "remembered": "v",
    "forgets": "v", "forgetting": "v", "forgot": "v", "forgotten": "v",

    # Common adjectives (comparative/superlative)
    "better": "a", "best": "a", "worse": "a", "worst": "a",
    "bigger": "a", "biggest": "a", "smaller": "a", "smallest": "a",
    "larger": "a", "largest": "a", "higher": "a", "highest": "a",
    "lower": "a", "lowest": "a", "longer": "a", "longest": "a",
    "shorter": "a", "shortest": "a", "faster": "a", "fastest": "a",
    "slower": "a", "slowest": "a", "stronger": "a", "strongest": "a",
    "weaker": "a", "weakest": "a", "older": "a", "oldest": "a",
    "younger": "a", "youngest": "a", "newer": "a", "newest": "a",
    "easier": "a", "easiest": "a", "harder": "a", "hardest": "a",
    "cleaner": "a", "cleanest": "a", "darker": "a", "darkest": "a",
    "lighter": "a", "lightest": "a", "heavier": "a", "heaviest": "a",
    "cheaper": "a", "cheapest": "a", "richer": "a", "richest": "a",
    "poorer": "a", "poorest": "a", "nicer": "a", "nicest": "a",
    "quieter": "a", "quietest": "a", "louder": "a", "loudest": "a",

    # Common adverbs
    "quickly": "r", "slowly": "r", "carefully": "r", "easily": "r",
    "happily": "r", "sadly": "r", "angrily": "r", "quietly": "r",
    "loudly": "r", "softly": "r", "gently": "r", "hardly": "r",
    "nearly": "r", "certainly": "r", "probably": "r", "possibly": "r",
    "actually": "r", "finally": "r", "recently": "r", "currently": "r",
    "generally": "r", "usually": "r", "normally": "r", "naturally": "r",
    "suddenly": "r", "immediately": "r", "directly": "r", "completely": "r",
    "absolutely": "r", "perfectly": "r", "exactly": "r", "nearly": "r",
    "closely": "r", "deeply": "r", "highly": "r", "widely": "r",
    "clearly": "r", "strongly": "r", "badly": "r", "well": "r",

    # Common nouns that might be confused
    "news": "n", "means": "n", "series": "n", "species": "n",
    "sheep": "n", "deer": "n", "fish": "n",

    # Common plural nouns that need explicit marking
    "slobs": "n", "slob": "n",
    "cheerleaders": "n", "cheerleader": "n",
    "movies": "n", "movie": "n",
    "words": "n", "word": "n",
    "scripts": "n", "script": "n",
    "books": "n", "book": "n",
    "stories": "n", "story": "n",
    "characters": "n", "character": "n",
    "actors": "n", "actor": "n",
    "scenes": "n", "scene": "n",
    "lines": "n", "line": "n",
    "dialogues": "n", "dialogue": "n",
    "subtitles": "n", "subtitle": "n",

    # Modal-like verbs
    "ought": "v", "dare": "v", "need": "v",

    # Irregular verbs
    "ate": "v", "eaten": "v", "eating": "v",
    "drank": "v", "drunk": "v", "drinking": "v",
    "drove": "v", "driven": "v", "driving": "v",
    "flew": "v", "flown": "v", "flying": "v",
    "rode": "v", "ridden": "v", "riding": "v",
    "sang": "v", "sung": "v", "singing": "v",
    "swam": "v", "swum": "v", "swimming": "v",
    "threw": "v", "thrown": "v", "throwing": "v",
    "wore": "v", "worn": "v", "wearing": "v",
    "wrote": "v", "written": "v",
    "broke": "v", "broken": "v", "breaking": "v",
    "chose": "v", "chosen": "v", "choosing": "v",
    "spoke": "v", "spoken": "v", "speaking": "v",
    "stole": "v", "stolen": "v", "stealing": "v",
    "forgot": "v", "forgotten": "v",
    "froze": "v", "frozen": "v", "freezing": "v",

    # Action verbs commonly seen in movies
    "fighting": "v", "fights": "v", "fought": "v",
    "killing": "v", "kills": "v", "killed": "v",
    "dying": "v", "dies": "v", "died": "v",
    "living": "v", "lives": "v", "lived": "v",
    "crying": "v", "cries": "v", "cried": "v",
    "laughing": "v", "laughs": "v", "laughed": "v",
    "screaming": "v", "screams": "v", "screamed": "v",
    "running": "v", "runs": "v", "ran": "v",
    "hiding": "v", "hides": "v", "hid": "v", "hidden": "v",
    "searching": "v", "searches": "v", "searched": "v",
    "watching": "v", "watches": "v", "watched": "v",
    "waiting": "v", "waits": "v", "waited": "v",
    "hoping": "v", "hopes": "v", "hoped": "v",
    "fearing": "v", "fears": "v", "feared": "v",
    "loving": "v", "loves": "v", "loved": "v",
    "hating": "v", "hates": "v", "hated": "v",

    # Emotional verbs
    "worrying": "v", "worries": "v", "worried": "v",
    "caring": "v", "cares": "v", "cared": "v",
    "trusting": "v", "trusts": "v", "trusted": "v",
    "doubting": "v", "doubts": "v", "doubted": "v",
    "believing": "v", "believes": "v", "believed": "v",
    "hoping": "v", "hopes": "v", "hoped": "v",
    "wishing": "v", "wishes": "v", "wished": "v",
    "dreaming": "v", "dreams": "v", "dreamed": "v", "dreamt": "v",

    # Communication verbs
    "explaining": "v", "explains": "v", "explained": "v",
    "describing": "v", "describes": "v", "described": "v",
    "mentioning": "v", "mentions": "v", "mentioned": "v",
    "discussing": "v", "discusses": "v", "discussed": "v",
    "arguing": "v", "argues": "v", "argued": "v",
    "agreeing": "v", "agrees": "v", "agreed": "v",
    "disagreeing": "v", "disagrees": "v", "disagreed": "v",
    "suggesting": "v", "suggests": "v", "suggested": "v",
    "promising": "v", "promises": "v", "promised": "v",
    "threatening": "v", "threatens": "v", "threatened": "v",
    "warning": "v", "warns": "v", "warned": "v",
    "ordering": "v", "orders": "v", "ordered": "v",
    "commanding": "v", "commands": "v", "commanded": "v",

    # Mental verbs
    "imagining": "v", "imagines": "v", "imagined": "v",
    "planning": "v", "plans": "v", "planned": "v",
    "deciding": "v", "decides": "v", "decided": "v",
    "choosing": "v", "chooses": "v", "chose": "v", "chosen": "v",
    "wondering": "v", "wonders": "v", "wondered": "v",
    "realizing": "v", "realizes": "v", "realized": "v",
    "noticing": "v", "notices": "v", "noticed": "v",
    "recognizing": "v", "recognizes": "v", "recognized": "v",

    # Common adjectives (base forms to ensure proper lemmatization)
    "good": "a", "bad": "a", "great": "a", "small": "a", "large": "a",
    "long": "a", "short": "a", "high": "a", "low": "a", "old": "a",
    "young": "a", "new": "a", "different": "a", "same": "a", "important": "a",
    "possible": "a", "impossible": "a", "real": "a", "true": "a", "false": "a",
    "right": "a", "wrong": "a", "sure": "a", "certain": "a", "clear": "a",
    "simple": "a", "complex": "a", "easy": "a", "hard": "a", "difficult": "a",
    "happy": "a", "sad": "a", "angry": "a", "afraid": "a", "worried": "a",
    "tired": "a", "hungry": "a", "thirsty": "a", "sick": "a", "healthy": "a",
    "rich": "a", "poor": "a", "expensive": "a", "cheap": "a", "free": "a",
    "beautiful": "a", "ugly": "a", "pretty": "a", "handsome": "a", "nice": "a",
    "kind": "a", "cruel": "a", "gentle": "a", "rough": "a", "soft": "a",
    "hard": "a", "strong": "a", "weak": "a", "powerful": "a", "dangerous": "a",
    "safe": "a", "careful": "a", "careless": "a", "brave": "a", "scared": "a",
}
