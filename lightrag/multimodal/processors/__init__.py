"""
Specialized modal processors for different content types.
"""

from lightrag.multimodal.processors.image import ImageModalProcessor
from lightrag.multimodal.processors.table import TableModalProcessor
from lightrag.multimodal.processors.equation import EquationModalProcessor
from lightrag.multimodal.processors.generic import GenericModalProcessor

__all__ = [
    "ImageModalProcessor",
    "TableModalProcessor",
    "EquationModalProcessor",
    "GenericModalProcessor",
]
