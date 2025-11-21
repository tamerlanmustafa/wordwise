"""
Script logging utility for debugging STANDS4 API responses
"""

import os
import json
from datetime import datetime
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

LOGS_DIR = Path(__file__).parent.parent.parent / "logs"
LOGS_DIR.mkdir(exist_ok=True)


def save_api_response(movie_title: str, response_data: dict, response_text: str = None):
    """
    Save STANDS4 API response to logs directory with timestamp

    Args:
        movie_title: Name of the movie searched
        response_data: Parsed JSON response
        response_text: Raw response text if available
    """
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_title = "".join(c for c in movie_title if c.isalnum() or c in (' ', '-', '_')).strip()
    safe_title = safe_title.replace(' ', '_')

    # Save JSON response
    json_file = LOGS_DIR / f"{timestamp}_{safe_title}_response.json"
    with open(json_file, 'w', encoding='utf-8') as f:
        json.dump(response_data, f, indent=2, ensure_ascii=False)

    logger.info(f"[LOGGER] Saved API response to: {json_file}")

    # Save raw text if available
    if response_text:
        text_file = LOGS_DIR / f"{timestamp}_{safe_title}_raw.txt"
        with open(text_file, 'w', encoding='utf-8') as f:
            f.write(response_text)
        logger.info(f"[LOGGER] Saved raw response to: {text_file}")


def save_script_content(movie_title: str, raw_script: str, cleaned_script: str):
    """
    Save raw and cleaned script content

    Args:
        movie_title: Name of the movie
        raw_script: Raw extracted script
        cleaned_script: Cleaned script ready for analysis
    """
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_title = "".join(c for c in movie_title if c.isalnum() or c in (' ', '-', '_')).strip()
    safe_title = safe_title.replace(' ', '_')

    # Save raw script
    raw_file = LOGS_DIR / f"{timestamp}_{safe_title}_script_raw.txt"
    with open(raw_file, 'w', encoding='utf-8') as f:
        f.write(raw_script)

    logger.info(f"[LOGGER] Saved raw script to: {raw_file}")
    logger.info(f"[LOGGER] Raw script length: {len(raw_script)} characters, {len(raw_script.split())} words")

    # Save cleaned script
    cleaned_file = LOGS_DIR / f"{timestamp}_{safe_title}_script_cleaned.txt"
    with open(cleaned_file, 'w', encoding='utf-8') as f:
        f.write(cleaned_script)

    logger.info(f"[LOGGER] Saved cleaned script to: {cleaned_file}")
    logger.info(f"[LOGGER] Cleaned script length: {len(cleaned_script)} characters, {len(cleaned_script.split())} words")

    # Warn if too short
    word_count = len(cleaned_script.split())
    if word_count < 10000:
        logger.warning(f"[WARNING] Script appears truncated! Only {word_count} words (expected 10,000+)")

    return {
        "raw_chars": len(raw_script),
        "raw_words": len(raw_script.split()),
        "cleaned_chars": len(cleaned_script),
        "cleaned_words": len(cleaned_script.split()),
        "raw_file": str(raw_file),
        "cleaned_file": str(cleaned_file)
    }


def log_html_extraction(html_content: str, extracted_fields: dict):
    """
    Log HTML extraction details

    Args:
        html_content: Raw HTML content
        extracted_fields: Dictionary of extracted fields
    """
    logger.info("[HTML EXTRACTION] Starting HTML parsing...")
    logger.info(f"[HTML] Raw HTML length: {len(html_content)} characters")

    # Check for common tags
    tags_found = []
    if '<pre>' in html_content or '<pre ' in html_content:
        tags_found.append('<pre>')
    if '<script>' in html_content or '<script ' in html_content:
        tags_found.append('<script>')
    if '<div class="script"' in html_content:
        tags_found.append('<div class="script">')
    if '<div class="dialogue"' in html_content:
        tags_found.append('<div class="dialogue">')

    logger.info(f"[HTML] Tags found: {tags_found if tags_found else 'None (plain text?)'}")

    # Log extracted fields
    for field_name, field_value in extracted_fields.items():
        if field_value:
            logger.info(f"[HTML] Extracted {field_name}: {len(str(field_value))} characters")
            logger.info(f"[HTML] {field_name} preview: {str(field_value)[:200]}...")
        else:
            logger.warning(f"[HTML] Field '{field_name}' is empty or not found")
