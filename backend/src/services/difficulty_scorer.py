from typing import Dict, Tuple
from prisma.enums import difficultylevel, proficiencylevel


def compute_difficulty(cefr_distribution: Dict[str, int]) -> Tuple[difficultylevel, int, Dict[str, int]]:
    total = sum(cefr_distribution.values())
    if total == 0:
        return difficultylevel.BEGINNER, 0, cefr_distribution

    percentages = {k: (v / total) * 100 for k, v in cefr_distribution.items()}

    a1_pct = percentages.get("A1", 0)
    a2_pct = percentages.get("A2", 0)
    b1_pct = percentages.get("B1", 0)
    b2_pct = percentages.get("B2", 0)
    c1_pct = percentages.get("C1", 0)
    c2_pct = percentages.get("C2", 0)

    weighted_sum = (
        a1_pct * 10 +
        a2_pct * 25 +
        b1_pct * 45 +
        b2_pct * 65 +
        c1_pct * 85 +
        c2_pct * 100
    )
    score = int(weighted_sum / 100 * 100)

    if (a1_pct + a2_pct) > 60:
        level = difficultylevel.ELEMENTARY
    elif b1_pct > 30 or ((a2_pct + b1_pct) > 50):
        level = difficultylevel.INTERMEDIATE
    elif b2_pct > 25:
        level = difficultylevel.ADVANCED
    elif (c1_pct + c2_pct) > 20:
        level = difficultylevel.PROFICIENT
    else:
        level = difficultylevel.INTERMEDIATE

    return level, score, cefr_distribution
