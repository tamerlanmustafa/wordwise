"""
Train the embedding-based CEFR classifier

This script trains a machine learning model using the CEFR wordlists
and sentence embeddings.

Usage:
    python -m src.utils.train_embedding_classifier --model logistic_regression
    python -m src.utils.train_embedding_classifier --model random_forest
    python -m src.utils.train_embedding_classifier --model all
"""

import logging
import argparse
from pathlib import Path
from sentence_transformers import SentenceTransformer
from src.services.cefr_classifier import HybridCEFRClassifier
from src.services.embedding_classifier_trainer import EmbeddingClassifierTrainer

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(description='Train CEFR embedding classifier')
    parser.add_argument(
        '--model',
        type=str,
        default='all',
        choices=['logistic_regression', 'random_forest', 'gradient_boosting', 'all'],
        help='Model type to train'
    )
    parser.add_argument(
        '--cv',
        action='store_true',
        help='Perform cross-validation'
    )
    parser.add_argument(
        '--cv-folds',
        type=int,
        default=5,
        help='Number of cross-validation folds'
    )

    args = parser.parse_args()

    # Setup paths
    backend_dir = Path(__file__).parent.parent.parent
    data_dir = backend_dir / "data" / "cefr"

    if not data_dir.exists():
        logger.error(f"Data directory not found: {data_dir}")
        logger.error("Run: python -m src.utils.download_cefr_data first")
        return

    logger.info("=" * 60)
    logger.info("CEFR EMBEDDING CLASSIFIER TRAINING")
    logger.info("=" * 60)

    # Load sentence transformer
    logger.info("Loading sentence transformer model...")
    model_path = data_dir / "sentence_transformer"
    if model_path.exists():
        sentence_model = SentenceTransformer(str(model_path))
    else:
        sentence_model = SentenceTransformer('all-MiniLM-L6-v2')
        sentence_model.save(str(model_path))
        logger.info(f"Saved sentence transformer to {model_path}")

    # Initialize classifier to load wordlists
    logger.info("Loading CEFR wordlists...")
    classifier = HybridCEFRClassifier(
        data_dir=data_dir,
        use_embedding_classifier=False  # Don't load classifier yet
    )

    # Prepare training data from wordlists
    cefr_wordlist = {
        word: (level.value, source.value)
        for word, (level, source) in classifier.cefr_wordlist.items()
    }

    logger.info(f"Loaded {len(cefr_wordlist)} CEFR-tagged words")

    if len(cefr_wordlist) < 100:
        logger.error("Not enough training data!")
        logger.error("Please download full CEFR wordlists first.")
        logger.error("See: python -m src.utils.download_cefr_data")
        return

    # Initialize trainer
    trainer = EmbeddingClassifierTrainer(data_dir, sentence_model)

    # Cross-validation
    if args.cv:
        logger.info("\n" + "=" * 60)
        logger.info("CROSS-VALIDATION")
        logger.info("=" * 60)

        if args.model == 'all':
            for model_type in ['logistic_regression', 'random_forest', 'gradient_boosting']:
                results = trainer.cross_validate(
                    cefr_wordlist,
                    model_type=model_type,
                    cv_folds=args.cv_folds
                )
                logger.info(f"\n{model_type}: {results['mean_score']:.3f} (+/- {results['std_score']:.3f})")
        else:
            results = trainer.cross_validate(
                cefr_wordlist,
                model_type=args.model,
                cv_folds=args.cv_folds
            )

    # Train models
    logger.info("\n" + "=" * 60)
    logger.info("TRAINING MODELS")
    logger.info("=" * 60)

    if args.model == 'all':
        results = trainer.train_all_models(cefr_wordlist)
        logger.info(f"\nBest model: {results['best_model_name']}")
        logger.info(f"Test accuracy: {results['best_score']:.3f}")
    else:
        # Train single model
        embeddings, labels, words = trainer.prepare_training_data(cefr_wordlist)

        from sklearn.model_selection import train_test_split
        X_train, X_test, y_train, y_test = train_test_split(
            embeddings, labels, test_size=0.2, random_state=42, stratify=labels
        )

        if args.model == 'logistic_regression':
            model = trainer.train_logistic_regression(X_train, y_train, X_test, y_test)
        elif args.model == 'random_forest':
            model = trainer.train_random_forest(X_train, y_train, X_test, y_test)
        elif args.model == 'gradient_boosting':
            model = trainer.train_gradient_boosting(X_train, y_train, X_test, y_test)

        # Save model
        import joblib
        model_path = data_dir / "cefr_classifier.joblib"
        joblib.dump(model, model_path)
        logger.info(f"Saved model to {model_path}")

    logger.info("\n" + "=" * 60)
    logger.info("TRAINING COMPLETE!")
    logger.info("=" * 60)
    logger.info(f"\nModel saved to: {data_dir / 'cefr_classifier.joblib'}")
    logger.info("\nYou can now use the HybridCEFRClassifier with embedding fallback!")


if __name__ == "__main__":
    main()
