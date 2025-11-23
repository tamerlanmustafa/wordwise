"""
Embedding-Based CEFR Classifier Trainer

Trains a machine learning model to classify words into CEFR levels
using sentence embeddings from sentence-transformers.

Supports multiple algorithms:
- Logistic Regression
- Random Forest
- Gradient Boosting (XGBoost)
"""

import logging
from pathlib import Path
from typing import List, Tuple, Dict
import json
import numpy as np
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.metrics import classification_report, confusion_matrix
import joblib

logger = logging.getLogger(__name__)


class EmbeddingClassifierTrainer:
    """
    Trains embedding-based classifiers for CEFR classification
    """

    def __init__(self, data_dir: Path, sentence_model):
        """
        Initialize trainer

        Args:
            data_dir: Directory to save trained models
            sentence_model: Pre-loaded SentenceTransformer model
        """
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.sentence_model = sentence_model

    def prepare_training_data(
        self,
        cefr_wordlist: Dict[str, Tuple[str, str]]
    ) -> Tuple[np.ndarray, np.ndarray, List[str]]:
        """
        Prepare training data from CEFR wordlist

        Args:
            cefr_wordlist: Dictionary of {word: (level, source)}

        Returns:
            (embeddings, labels, words)
        """
        logger.info("Preparing training data...")

        words = []
        labels = []

        for word, (level, _) in cefr_wordlist.items():
            # Skip unknown levels
            if level == "UNKNOWN":
                continue

            words.append(word)
            labels.append(level)

        logger.info(f"Generating embeddings for {len(words)} words...")

        # Generate embeddings
        embeddings = self.sentence_model.encode(
            words,
            show_progress_bar=True,
            batch_size=32
        )

        return embeddings, np.array(labels), words

    def train_logistic_regression(
        self,
        X_train: np.ndarray,
        y_train: np.ndarray,
        X_test: np.ndarray,
        y_test: np.ndarray
    ) -> LogisticRegression:
        """Train logistic regression classifier"""
        logger.info("Training Logistic Regression classifier...")

        model = LogisticRegression(
            max_iter=1000,
            multi_class='multinomial',
            solver='lbfgs',
            C=1.0,
            random_state=42
        )

        model.fit(X_train, y_train)

        # Evaluate
        train_score = model.score(X_train, y_train)
        test_score = model.score(X_test, y_test)

        logger.info(f"Logistic Regression - Train: {train_score:.3f}, Test: {test_score:.3f}")

        return model

    def train_random_forest(
        self,
        X_train: np.ndarray,
        y_train: np.ndarray,
        X_test: np.ndarray,
        y_test: np.ndarray
    ) -> RandomForestClassifier:
        """Train random forest classifier"""
        logger.info("Training Random Forest classifier...")

        model = RandomForestClassifier(
            n_estimators=100,
            max_depth=20,
            min_samples_split=5,
            min_samples_leaf=2,
            random_state=42,
            n_jobs=-1
        )

        model.fit(X_train, y_train)

        # Evaluate
        train_score = model.score(X_train, y_train)
        test_score = model.score(X_test, y_test)

        logger.info(f"Random Forest - Train: {train_score:.3f}, Test: {test_score:.3f}")

        return model

    def train_gradient_boosting(
        self,
        X_train: np.ndarray,
        y_train: np.ndarray,
        X_test: np.ndarray,
        y_test: np.ndarray
    ) -> GradientBoostingClassifier:
        """Train gradient boosting classifier"""
        logger.info("Training Gradient Boosting classifier...")

        model = GradientBoostingClassifier(
            n_estimators=100,
            learning_rate=0.1,
            max_depth=5,
            random_state=42
        )

        model.fit(X_train, y_train)

        # Evaluate
        train_score = model.score(X_train, y_train)
        test_score = model.score(X_test, y_test)

        logger.info(f"Gradient Boosting - Train: {train_score:.3f}, Test: {test_score:.3f}")

        return model

    def train_all_models(
        self,
        cefr_wordlist: Dict[str, Tuple[str, str]],
        test_size: float = 0.2
    ) -> Dict[str, any]:
        """
        Train all classifier models and return the best one

        Args:
            cefr_wordlist: Dictionary of {word: (level, source)}
            test_size: Fraction of data to use for testing

        Returns:
            Dictionary with best model and evaluation metrics
        """
        # Prepare data
        embeddings, labels, words = self.prepare_training_data(cefr_wordlist)

        # Split data
        X_train, X_test, y_train, y_test, words_train, words_test = train_test_split(
            embeddings,
            labels,
            words,
            test_size=test_size,
            random_state=42,
            stratify=labels
        )

        logger.info(f"Training set: {len(X_train)} samples")
        logger.info(f"Test set: {len(X_test)} samples")

        # Train all models
        models = {
            'logistic_regression': self.train_logistic_regression(X_train, y_train, X_test, y_test),
            'random_forest': self.train_random_forest(X_train, y_train, X_test, y_test),
            'gradient_boosting': self.train_gradient_boosting(X_train, y_train, X_test, y_test)
        }

        # Evaluate all models
        results = {}
        best_model_name = None
        best_score = 0.0

        for name, model in models.items():
            # Test score
            test_score = model.score(X_test, y_test)

            # Predictions
            y_pred = model.predict(X_test)

            # Classification report
            report = classification_report(y_test, y_pred, output_dict=True)

            # Confusion matrix
            conf_matrix = confusion_matrix(y_test, y_pred)

            results[name] = {
                'model': model,
                'test_score': test_score,
                'classification_report': report,
                'confusion_matrix': conf_matrix.tolist()
            }

            logger.info(f"\n{name.upper()} Results:")
            logger.info(f"Test Accuracy: {test_score:.3f}")
            logger.info(f"\n{classification_report(y_test, y_pred)}")

            # Track best model
            if test_score > best_score:
                best_score = test_score
                best_model_name = name

        logger.info(f"\nBest model: {best_model_name} (score: {best_score:.3f})")

        # Save best model
        best_model = results[best_model_name]['model']
        model_path = self.data_dir / "cefr_classifier.joblib"
        joblib.dump(best_model, model_path)
        logger.info(f"Saved best model to {model_path}")

        # Save metadata
        metadata = {
            'best_model': best_model_name,
            'test_score': best_score,
            'training_samples': len(X_train),
            'test_samples': len(X_test),
            'classes': list(set(labels))
        }

        metadata_path = self.data_dir / "classifier_metadata.json"
        with open(metadata_path, 'w') as f:
            json.dump(metadata, f, indent=2)

        return {
            'best_model_name': best_model_name,
            'best_model': best_model,
            'best_score': best_score,
            'all_results': results
        }

    def cross_validate(
        self,
        cefr_wordlist: Dict[str, Tuple[str, str]],
        model_type: str = 'logistic_regression',
        cv_folds: int = 5
    ) -> Dict:
        """
        Perform cross-validation

        Args:
            cefr_wordlist: Dictionary of {word: (level, source)}
            model_type: Type of model to use
            cv_folds: Number of cross-validation folds

        Returns:
            Cross-validation results
        """
        logger.info(f"Performing {cv_folds}-fold cross-validation...")

        # Prepare data
        embeddings, labels, words = self.prepare_training_data(cefr_wordlist)

        # Select model
        if model_type == 'logistic_regression':
            model = LogisticRegression(max_iter=1000, random_state=42)
        elif model_type == 'random_forest':
            model = RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1)
        elif model_type == 'gradient_boosting':
            model = GradientBoostingClassifier(n_estimators=100, random_state=42)
        else:
            raise ValueError(f"Unknown model type: {model_type}")

        # Cross-validate
        scores = cross_val_score(model, embeddings, labels, cv=cv_folds, n_jobs=-1)

        logger.info(f"Cross-validation scores: {scores}")
        logger.info(f"Mean: {scores.mean():.3f} (+/- {scores.std() * 2:.3f})")

        return {
            'model_type': model_type,
            'cv_folds': cv_folds,
            'scores': scores.tolist(),
            'mean_score': float(scores.mean()),
            'std_score': float(scores.std())
        }
