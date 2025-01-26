from .models import PromptElements, ObjectiveCriteriaResponse
from openai import AsyncOpenAI
import instructor
import os
from typing import Dict, List, Optional
from .models import TechnicalIssueCategory, ISSUE_CATEGORY_MAPPING


def categorize_issue(issue: str) -> TechnicalIssueCategory:
    """Categorize a technical issue based on its description."""
    issue_lower = issue.lower()

    # Check each keyword in the mapping
    for keyword, category in ISSUE_CATEGORY_MAPPING.items():
        if keyword in issue_lower:
            return category

    # If no matching keywords found, return OTHER
    return TechnicalIssueCategory.OTHER

def aggregate_issues_by_category(issues: List[str]) -> Dict[str, int]:
    """Convert a list of specific issues into categorized counts."""
    category_counts = {}

    for issue in issues:
        category = categorize_issue(issue)
        category_counts[category] = category_counts.get(category, 0) + 1

    return category_counts

async def break_down_prompt(prompt: str) -> PromptElements:
    """Extract key visual elements from an image generation prompt."""
    client = instructor.apatch(AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"]))

    return await client.chat.completions.create(
        model="gpt-4o",
        response_model=PromptElements,
        messages=[
            {
                "role": "user",
                "content": f"""Break down this image generation prompt into its essential visual elements: "{prompt}"

                Rules:
                1. Each element should be a distinct, assessable visual component
                2. Include specific attributes (colors, materials, etc.)
                3. Include environmental or contextual elements
                4. Include important spatial relationships
                5. Break complex objects into key parts if needed

                The elements should be specific enough that each one can be clearly verified as present or absent in an image."""
            }
        ],
        temperature=0.0
    )
