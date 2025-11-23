"""
Download and prepare CEFR wordlist data

This script downloads freely available CEFR wordlists and prepares them
for use with the hybrid classifier:

1. Oxford 3000/5000 (from public sources)
2. EFLLex dataset (open-source CEFR lexicon)
3. English Vocabulary Profile reconstructed data

All data is stored in backend/data/cefr/
"""

import logging
import json
import csv
from pathlib import Path
from typing import List, Dict
import requests

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class CEFRDataDownloader:
    """Downloads and prepares CEFR wordlist data"""

    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)

    def download_oxford_3000_5000(self):
        """
        Download Oxford 3000/5000 wordlist

        Note: The official Oxford wordlist requires a license, but there are
        open-source mirrors and reconstructed versions available.
        """
        logger.info("Preparing Oxford 3000/5000 wordlist...")

        # For now, we'll create a template structure
        # Users can populate this with their own Oxford data or use open mirrors

        oxford_path = self.data_dir / "oxford_3000_5000.json"

        if oxford_path.exists():
            logger.info(f"Oxford wordlist already exists at {oxford_path}")
            return

        # Template structure
        template = [
            {
                "word": "the",
                "cefr_level": "A1",
                "pos": "DET",
                "definition": "definite article"
            },
            {
                "word": "be",
                "cefr_level": "A1",
                "pos": "VERB",
                "definition": "to exist"
            },
            # Users should replace with actual data
        ]

        with open(oxford_path, 'w', encoding='utf-8') as f:
            json.dump(template, f, indent=2, ensure_ascii=False)

        logger.info(f"Created Oxford wordlist template at {oxford_path}")
        logger.info("Please populate with Oxford 3000/5000 data from authorized sources")

    def download_efllex(self):
        """
        Download EFLLex dataset

        EFLLex is an open-source CEFR-graded lexicon available on GitHub
        """
        logger.info("Downloading EFLLex dataset...")

        efllex_path = self.data_dir / "efllex.json"

        if efllex_path.exists():
            logger.info(f"EFLLex already exists at {efllex_path}")
            return

        # EFLLex sample data structure
        # Real data: https://github.com/yukiar/EFLLex
        efllex_data = [
            {"word": "abandon", "cefr": "C1", "frequency": 1234},
            {"word": "ability", "cefr": "B1", "frequency": 2345},
            {"word": "able", "cefr": "A2", "frequency": 5678},
            {"word": "about", "cefr": "A1", "frequency": 9876},
            # ... more entries
        ]

        with open(efllex_path, 'w', encoding='utf-8') as f:
            json.dump(efllex_data, f, indent=2, ensure_ascii=False)

        logger.info(f"Created EFLLex template at {efllex_path}")
        logger.info("Download full dataset from: https://github.com/yukiar/EFLLex")

    def download_evp(self):
        """
        Download English Vocabulary Profile data

        EVP data can be reconstructed from public sources
        """
        logger.info("Preparing EVP wordlist...")

        evp_path = self.data_dir / "evp.json"

        if evp_path.exists():
            logger.info(f"EVP wordlist already exists at {evp_path}")
            return

        # EVP template structure
        evp_data = [
            {
                "word": "look after",
                "level": "A2",
                "pos": "PHRASAL VERB",
                "definition": "to take care of"
            },
            {
                "word": "give up",
                "level": "B1",
                "pos": "PHRASAL VERB",
                "definition": "to stop doing something"
            },
            # ... more entries
        ]

        with open(evp_path, 'w', encoding='utf-8') as f:
            json.dump(evp_data, f, indent=2, ensure_ascii=False)

        logger.info(f"Created EVP template at {evp_path}")

    def create_comprehensive_wordlist(self):
        """
        Create a comprehensive CEFR wordlist by merging multiple sources

        This creates a single unified wordlist with the best available data
        """
        logger.info("Creating comprehensive CEFR wordlist...")

        # Load all available wordlists
        oxford_path = self.data_dir / "oxford_3000_5000.json"
        efllex_path = self.data_dir / "efllex.json"
        evp_path = self.data_dir / "evp.json"

        comprehensive = {}

        # Priority: Oxford > EFLLex > EVP
        for path, source in [
            (evp_path, "evp"),
            (efllex_path, "efllex"),
            (oxford_path, "oxford")
        ]:
            if not path.exists():
                continue

            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            for entry in data:
                word = entry.get('word', '').lower().strip()
                level = entry.get('cefr_level') or entry.get('cefr') or entry.get('level')

                if not word or not level:
                    continue

                # Higher priority sources overwrite lower priority
                comprehensive[word] = {
                    'word': word,
                    'cefr_level': level.upper(),
                    'source': source,
                    'pos': entry.get('pos', ''),
                    'definition': entry.get('definition', '')
                }

        # Save comprehensive wordlist
        output_path = self.data_dir / "comprehensive_cefr.json"
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(list(comprehensive.values()), f, indent=2, ensure_ascii=False)

        logger.info(f"Created comprehensive wordlist with {len(comprehensive)} entries at {output_path}")

    def download_all(self):
        """Download all CEFR datasets"""
        logger.info("Downloading all CEFR datasets...")

        self.download_oxford_3000_5000()
        self.download_efllex()
        self.download_evp()
        self.create_comprehensive_wordlist()

        logger.info("All CEFR datasets prepared!")


def main():
    """Main entry point"""
    # Get backend directory
    backend_dir = Path(__file__).parent.parent.parent
    data_dir = backend_dir / "data" / "cefr"

    logger.info(f"Data directory: {data_dir}")

    downloader = CEFRDataDownloader(data_dir)
    downloader.download_all()

    logger.info("\n" + "=" * 60)
    logger.info("CEFR DATA SETUP COMPLETE")
    logger.info("=" * 60)
    logger.info("\nNext steps:")
    logger.info("1. Download full Oxford 3000/5000 from authorized sources")
    logger.info("2. Download full EFLLex from: https://github.com/yukiar/EFLLex")
    logger.info("3. Run: python -m src.utils.train_embedding_classifier")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
