from __future__ import annotations

import os
import aiohttp
from typing import Any, List, Dict, Optional, Tuple
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)
from .utils import logger

from dotenv import load_dotenv

# use the .env that is inside the current folder
# allows to use different .env file for each lightrag instance
# the OS environment variables take precedence over the .env file
load_dotenv(dotenv_path=".env", override=False)


def chunk_documents_for_rerank(
    documents: List[str],
    max_tokens: int = 480,
    overlap_tokens: int = 32,
    tokenizer_model: str = "gpt-4o-mini",
) -> Tuple[List[str], List[int]]:
    """
    Chunk documents that exceed token limit for reranking.

    Args:
        documents: List of document strings to chunk
        max_tokens: Maximum tokens per chunk (default 480 to leave margin for 512 limit)
        overlap_tokens: Number of tokens to overlap between chunks
        tokenizer_model: Model name for tiktoken tokenizer

    Returns:
        Tuple of (chunked_documents, original_doc_indices)
        - chunked_documents: List of document chunks (may be more than input)
        - original_doc_indices: Maps each chunk back to its original document index
    """
    # Clamp overlap_tokens to ensure the loop always advances
    # If overlap_tokens >= max_tokens, the chunking loop would hang
    if overlap_tokens >= max_tokens:
        original_overlap = overlap_tokens
        # Ensure overlap is at least 1 token less than max to guarantee progress
        # For very small max_tokens (e.g., 1), set overlap to 0
        overlap_tokens = max(0, max_tokens - 1)
        logger.warning(
            f"overlap_tokens ({original_overlap}) must be less than max_tokens ({max_tokens}). "
            f"Clamping to {overlap_tokens} to prevent infinite loop."
        )

    try:
        from .utils import TiktokenTokenizer

        tokenizer = TiktokenTokenizer(model_name=tokenizer_model)
    except Exception as e:
        logger.warning(
            f"Failed to initialize tokenizer: {e}. Using character-based approximation."
        )
        # Fallback: approximate 1 token ≈ 4 characters
        max_chars = max_tokens * 4
        overlap_chars = overlap_tokens * 4

        chunked_docs = []
        doc_indices = []

        for idx, doc in enumerate(documents):
            if len(doc) <= max_chars:
                chunked_docs.append(doc)
                doc_indices.append(idx)
            else:
                # Split into overlapping chunks
                start = 0
                while start < len(doc):
                    end = min(start + max_chars, len(doc))
                    chunk = doc[start:end]
                    chunked_docs.append(chunk)
                    doc_indices.append(idx)

                    if end >= len(doc):
                        break
                    start = end - overlap_chars

        return chunked_docs, doc_indices

    # Use tokenizer for accurate chunking
    chunked_docs = []
    doc_indices = []

    for idx, doc in enumerate(documents):
        tokens = tokenizer.encode(doc)

        if len(tokens) <= max_tokens:
            # Document fits in one chunk
            chunked_docs.append(doc)
            doc_indices.append(idx)
        else:
            # Split into overlapping chunks
            start = 0
            while start < len(tokens):
                end = min(start + max_tokens, len(tokens))
                chunk_tokens = tokens[start:end]
                chunk_text = tokenizer.decode(chunk_tokens)
                chunked_docs.append(chunk_text)
                doc_indices.append(idx)

                if end >= len(tokens):
                    break
                start = end - overlap_tokens

    return chunked_docs, doc_indices


def aggregate_chunk_scores(
    chunk_results: List[Dict[str, Any]],
    doc_indices: List[int],
    num_original_docs: int,
    aggregation: str = "max",
) -> List[Dict[str, Any]]:
    """
    Aggregate rerank scores from document chunks back to original documents.

    Args:
        chunk_results: Rerank results for chunks [{"index": chunk_idx, "relevance_score": score}, ...]
        doc_indices: Maps each chunk index to original document index
        num_original_docs: Total number of original documents
        aggregation: Strategy for aggregating scores ("max", "mean", "first")

    Returns:
        List of results for original documents [{"index": doc_idx, "relevance_score": score}, ...]
    """
    # Group scores by original document index
    doc_scores: Dict[int, List[float]] = {i: [] for i in range(num_original_docs)}

    for result in chunk_results:
        chunk_idx = result["index"]
        score = result["relevance_score"]

        if 0 <= chunk_idx < len(doc_indices):
            original_doc_idx = doc_indices[chunk_idx]
            doc_scores[original_doc_idx].append(score)

    # Aggregate scores
    aggregated_results = []
    for doc_idx, scores in doc_scores.items():
        if not scores:
            continue

        if aggregation == "max":
            final_score = max(scores)
        elif aggregation == "mean":
            final_score = sum(scores) / len(scores)
        elif aggregation == "first":
            final_score = scores[0]
        else:
            logger.warning(f"Unknown aggregation strategy: {aggregation}, using max")
            final_score = max(scores)

        aggregated_results.append(
            {
                "index": doc_idx,
                "relevance_score": final_score,
            }
        )

    # Sort by relevance score (descending)
    aggregated_results.sort(key=lambda x: x["relevance_score"], reverse=True)

    return aggregated_results


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=4, max=60),
    retry=(
        retry_if_exception_type(aiohttp.ClientError)
        | retry_if_exception_type(aiohttp.ClientResponseError)
    ),
)
async def generic_rerank_api(
    query: str,
    documents: List[str],
    model: str,
    base_url: str,
    api_key: Optional[str],
    top_n: Optional[int] = None,
    return_documents: Optional[bool] = None,
    extra_body: Optional[Dict[str, Any]] = None,
    response_format: str = "standard",  # "standard" (Jina/Cohere) or "aliyun"
    request_format: str = "standard",  # "standard" (Jina/Cohere) or "aliyun"
    enable_chunking: bool = False,
    max_tokens_per_doc: int = 480,
) -> List[Dict[str, Any]]:
    """
    Generic rerank API call for Jina/Cohere/Aliyun models.

    Args:
        query: The search query
        documents: List of strings to rerank
        model: Model name to use
        base_url: API endpoint URL
        api_key: API key for authentication
        top_n: Number of top results to return
        return_documents: Whether to return document text (Jina only)
        extra_body: Additional body parameters
        response_format: Response format type ("standard" for Jina/Cohere, "aliyun" for Aliyun)
        request_format: Request format type
        enable_chunking: Whether to chunk documents exceeding token limit
        max_tokens_per_doc: Maximum tokens per document for chunking

    Returns:
        List of dictionary of ["index": int, "relevance_score": float]
    """
    if not base_url:
        raise ValueError("Base URL is required")

    headers = {"Content-Type": "application/json"}
    if api_key is not None:
        headers["Authorization"] = f"Bearer {api_key}"

    # Handle document chunking if enabled
    original_documents = documents
    doc_indices = None
    original_top_n = top_n  # Save original top_n for post-aggregation limiting

    if enable_chunking:
        documents, doc_indices = chunk_documents_for_rerank(
            documents, max_tokens=max_tokens_per_doc
        )
        logger.debug(
            f"Chunked {len(original_documents)} documents into {len(documents)} chunks"
        )
        # When chunking is enabled, disable top_n at API level to get all chunk scores
        # This ensures proper document-level coverage after aggregation
        # We'll apply top_n to aggregated document results instead
        if top_n is not None:
            logger.debug(
                f"Chunking enabled: disabled API-level top_n={top_n} to ensure complete document coverage"
            )
            top_n = None

    # Build request payload based on request format
    if request_format == "aliyun":
        # Aliyun format: nested input/parameters structure
        payload = {
            "model": model,
            "input": {
                "query": query,
                "documents": documents,
            },
            "parameters": {},
        }

        # Add optional parameters to parameters object
        if top_n is not None:
            payload["parameters"]["top_n"] = top_n

        if return_documents is not None:
            payload["parameters"]["return_documents"] = return_documents

        # Add extra parameters to parameters object
        if extra_body:
            payload["parameters"].update(extra_body)
    else:
        # Standard format for Jina/Cohere/OpenAI
        payload = {
            "model": model,
            "query": query,
            "documents": documents,
        }

        # Add optional parameters
        if top_n is not None:
            payload["top_n"] = top_n

        # Only Jina API supports return_documents parameter
        if return_documents is not None and response_format in ("standard",):
            payload["return_documents"] = return_documents

        # Add extra parameters
        if extra_body:
            payload.update(extra_body)

    logger.debug(
        f"Rerank request: {len(documents)} documents, model: {model}, format: {response_format}"
    )

    async with aiohttp.ClientSession() as session:
        async with session.post(base_url, headers=headers, json=payload) as response:
            if response.status != 200:
                error_text = await response.text()
                content_type = response.headers.get("content-type", "").lower()
                is_html_error = (
                    error_text.strip().startswith("<!DOCTYPE html>")
                    or "text/html" in content_type
                )
                if is_html_error:
                    if response.status == 502:
                        clean_error = "Bad Gateway (502) - Rerank service temporarily unavailable. Please try again in a few minutes."
                    elif response.status == 503:
                        clean_error = "Service Unavailable (503) - Rerank service is temporarily overloaded. Please try again later."
                    elif response.status == 504:
                        clean_error = "Gateway Timeout (504) - Rerank service request timed out. Please try again."
                    else:
                        clean_error = f"HTTP {response.status} - Rerank service error. Please try again later."
                else:
                    clean_error = error_text
                logger.error(f"Rerank API error {response.status}: {clean_error}")
                raise aiohttp.ClientResponseError(
                    request_info=response.request_info,
                    history=response.history,
                    status=response.status,
                    message=f"Rerank API error: {clean_error}",
                )

            response_json = await response.json()

            if response_format == "aliyun":
                # Aliyun format: {"output": {"results": [...]}}
                results = response_json.get("output", {}).get("results", [])
                if not isinstance(results, list):
                    logger.warning(
                        f"Expected 'output.results' to be list, got {type(results)}: {results}"
                    )
                    results = []
            elif response_format == "standard":
                # Standard format: {"results": [...]}
                results = response_json.get("results", [])
                if not isinstance(results, list):
                    logger.warning(
                        f"Expected 'results' to be list, got {type(results)}: {results}"
                    )
                    results = []
            else:
                raise ValueError(f"Unsupported response format: {response_format}")

            if not results:
                logger.warning("Rerank API returned empty results")
                return []

            # Standardize return format
            standardized_results = [
                {"index": result["index"], "relevance_score": result["relevance_score"]}
                for result in results
            ]

            # Aggregate chunk scores back to original documents if chunking was enabled
            if enable_chunking and doc_indices:
                standardized_results = aggregate_chunk_scores(
                    standardized_results,
                    doc_indices,
                    len(original_documents),
                    aggregation="max",
                )
                # Apply original top_n limit at document level (post-aggregation)
                # This preserves document-level semantics: top_n limits documents, not chunks
                if (
                    original_top_n is not None
                    and len(standardized_results) > original_top_n
                ):
                    standardized_results = standardized_results[:original_top_n]

            return standardized_results


async def cohere_rerank(
    query: str,
    documents: List[str],
    top_n: Optional[int] = None,
    api_key: Optional[str] = None,
    model: str = "rerank-v3.5",
    base_url: str = "https://api.cohere.com/v2/rerank",
    extra_body: Optional[Dict[str, Any]] = None,
    enable_chunking: bool = False,
    max_tokens_per_doc: int = 4096,
) -> List[Dict[str, Any]]:
    """
    Rerank documents using Cohere API.

    Supports both standard Cohere API and Cohere-compatible proxies

    Args:
        query: The search query
        documents: List of strings to rerank
        top_n: Number of top results to return
        api_key: API key for authentication
        model: rerank model name (default: rerank-v3.5)
        base_url: API endpoint
        extra_body: Additional body for http request(reserved for extra params)
        enable_chunking: Whether to chunk documents exceeding max_tokens_per_doc
        max_tokens_per_doc: Maximum tokens per document (default: 4096 for Cohere v3.5)

    Returns:
        List of dictionary of ["index": int, "relevance_score": float]

    Example:
        >>> # Standard Cohere API
        >>> results = await cohere_rerank(
        ...     query="What is the meaning of life?",
        ...     documents=["Doc1", "Doc2"],
        ...     api_key="your-cohere-key"
        ... )

        >>> # LiteLLM proxy with user authentication
        >>> results = await cohere_rerank(
        ...     query="What is vector search?",
        ...     documents=["Doc1", "Doc2"],
        ...     model="answerai-colbert-small-v1",
        ...     base_url="https://llm-proxy.example.com/v2/rerank",
        ...     api_key="your-proxy-key",
        ...     enable_chunking=True,
        ...     max_tokens_per_doc=480
        ... )
    """
    if api_key is None:
        api_key = os.getenv("COHERE_API_KEY") or os.getenv("RERANK_BINDING_API_KEY")

    return await generic_rerank_api(
        query=query,
        documents=documents,
        model=model,
        base_url=base_url,
        api_key=api_key,
        top_n=top_n,
        return_documents=None,  # Cohere doesn't support this parameter
        extra_body=extra_body,
        response_format="standard",
        enable_chunking=enable_chunking,
        max_tokens_per_doc=max_tokens_per_doc,
    )


async def jina_rerank(
    query: str,
    documents: List[str],
    top_n: Optional[int] = None,
    api_key: Optional[str] = None,
    model: str = "jina-reranker-v2-base-multilingual",
    base_url: str = "https://api.jina.ai/v1/rerank",
    extra_body: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """
    Rerank documents using Jina AI API.

    Args:
        query: The search query
        documents: List of strings to rerank
        top_n: Number of top results to return
        api_key: API key
        model: rerank model name
        base_url: API endpoint
        extra_body: Additional body for http request(reserved for extra params)

    Returns:
        List of dictionary of ["index": int, "relevance_score": float]
    """
    if api_key is None:
        api_key = os.getenv("JINA_API_KEY") or os.getenv("RERANK_BINDING_API_KEY")

    return await generic_rerank_api(
        query=query,
        documents=documents,
        model=model,
        base_url=base_url,
        api_key=api_key,
        top_n=top_n,
        return_documents=False,
        extra_body=extra_body,
        response_format="standard",
    )


async def _tei_rerank_batch(
    query: str,
    documents: List[str],
    base_url: str,
    headers: Dict[str, str],
    batch_offset: int = 0,
) -> List[Dict[str, Any]]:
    """
    Internal function to rerank a single batch of documents.

    Args:
        query: The search query
        documents: List of document strings (should be <= max_batch_size)
        base_url: API endpoint URL
        headers: Request headers
        batch_offset: Index offset for this batch in the original document list

    Returns:
        List of results with adjusted indices
    """
    payload = {
        "query": query,
        "texts": documents,
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(base_url, headers=headers, json=payload) as response:
            if response.status != 200:
                error_text = await response.text()
                logger.error(f"TEI Rerank API error {response.status}: {error_text}")
                raise aiohttp.ClientResponseError(
                    request_info=response.request_info,
                    history=response.history,
                    status=response.status,
                    message=f"TEI Rerank API error: {error_text}",
                )

            response_json = await response.json()

            # TEI format returns array directly: [{"index": int, "score": float}]
            if isinstance(response_json, list):
                results = response_json
            else:
                results = response_json.get("results", response_json)

            # Adjust indices to account for batch offset
            adjusted_results = [
                {
                    "index": result["index"] + batch_offset,
                    "relevance_score": result.get("score", result.get("relevance_score", 0.0))
                }
                for result in results
            ]

            return adjusted_results


async def tei_rerank(
    query: str,
    documents: List[str],
    top_n: Optional[int] = None,
    api_key: Optional[str] = None,
    model: str = "bge-reranker-v2-m3",
    base_url: str = "http://localhost:8080/rerank",
    extra_body: Optional[Dict[str, Any]] = None,
    enable_chunking: bool = False,
    max_tokens_per_doc: int = 480,
    max_batch_size: int = 64,
) -> List[Dict[str, Any]]:
    """
    Rerank documents using TEI (Text Embeddings Inference) compatible API.

    This supports Hugging Face TEI server and similar servers that use
    the format: {"query": str, "texts": [str]} -> [{"index": int, "score": float}]

    Automatically handles batching for large document lists that exceed
    the server's maximum batch size.

    Args:
        query: The search query
        documents: List of strings to rerank
        top_n: Number of top results to return
        api_key: API key for authentication (optional)
        model: Model name (for logging purposes)
        base_url: API endpoint URL
        extra_body: Additional body parameters
        enable_chunking: Whether to chunk documents exceeding token limit
        max_tokens_per_doc: Maximum tokens per document for chunking
        max_batch_size: Maximum documents per API call (default: 64 for TEI)

    Returns:
        List of dictionary of ["index": int, "relevance_score": float]
    """
    if not base_url:
        raise ValueError("Base URL is required")

    headers = {"Content-Type": "application/json"}
    if api_key is not None and api_key != "EMPTY":
        headers["Authorization"] = f"Bearer {api_key}"

    # Handle document chunking if enabled
    original_documents = documents
    doc_indices = None

    if enable_chunking:
        documents, doc_indices = chunk_documents_for_rerank(
            documents, max_tokens=max_tokens_per_doc
        )
        logger.debug(
            f"Chunked {len(original_documents)} documents into {len(documents)} chunks"
        )

    logger.debug(
        f"TEI Rerank request: {len(documents)} documents, model: {model}, batch_size: {max_batch_size}"
    )

    # Split documents into batches if needed
    all_results = []
    num_batches = (len(documents) + max_batch_size - 1) // max_batch_size

    for batch_idx in range(num_batches):
        start_idx = batch_idx * max_batch_size
        end_idx = min(start_idx + max_batch_size, len(documents))
        batch_docs = documents[start_idx:end_idx]

        logger.debug(
            f"Processing batch {batch_idx + 1}/{num_batches}: documents {start_idx}-{end_idx - 1}"
        )

        # Retry logic for each batch
        max_retries = 3
        for retry in range(max_retries):
            try:
                batch_results = await _tei_rerank_batch(
                    query=query,
                    documents=batch_docs,
                    base_url=base_url,
                    headers=headers,
                    batch_offset=start_idx,
                )
                all_results.extend(batch_results)
                break
            except aiohttp.ClientResponseError as e:
                if retry < max_retries - 1:
                    import asyncio
                    wait_time = 4 * (2 ** retry)  # Exponential backoff
                    logger.warning(f"Batch {batch_idx + 1} failed, retrying in {wait_time}s: {e}")
                    await asyncio.sleep(wait_time)
                else:
                    raise

    if not all_results:
        logger.warning("TEI Rerank API returned empty results")
        return []

    # Sort by score descending
    all_results.sort(key=lambda x: x["relevance_score"], reverse=True)

    # Aggregate chunk scores back to original documents if chunking was enabled
    if enable_chunking and doc_indices:
        all_results = aggregate_chunk_scores(
            all_results,
            doc_indices,
            len(original_documents),
            aggregation="max",
        )

    # Apply top_n limit
    if top_n is not None and len(all_results) > top_n:
        all_results = all_results[:top_n]

    return all_results


async def ali_rerank(
    query: str,
    documents: List[str],
    top_n: Optional[int] = None,
    api_key: Optional[str] = None,
    model: str = "gte-rerank-v2",
    base_url: str = "https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank",
    extra_body: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """
    Rerank documents using Aliyun DashScope API.

    Args:
        query: The search query
        documents: List of strings to rerank
        top_n: Number of top results to return
        api_key: Aliyun API key
        model: rerank model name
        base_url: API endpoint
        extra_body: Additional body for http request(reserved for extra params)

    Returns:
        List of dictionary of ["index": int, "relevance_score": float]
    """
    if api_key is None:
        api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("RERANK_BINDING_API_KEY")

    return await generic_rerank_api(
        query=query,
        documents=documents,
        model=model,
        base_url=base_url,
        api_key=api_key,
        top_n=top_n,
        return_documents=False,  # Aliyun doesn't need this parameter
        extra_body=extra_body,
        response_format="aliyun",
        request_format="aliyun",
    )


"""Please run this test as a module:
python -m lightrag.rerank
"""
if __name__ == "__main__":
    import asyncio

    async def main():
        # Example usage - documents should be strings, not dictionaries
        docs = [
            "The capital of France is Paris.",
            "Tokyo is the capital of Japan.",
            "London is the capital of England.",
        ]

        query = "What is the capital of France?"

        # Test Jina rerank
        try:
            print("=== Jina Rerank ===")
            result = await jina_rerank(
                query=query,
                documents=docs,
                top_n=2,
            )
            print("Results:")
            for item in result:
                print(f"Index: {item['index']}, Score: {item['relevance_score']:.4f}")
                print(f"Document: {docs[item['index']]}")
        except Exception as e:
            print(f"Jina Error: {e}")

        # Test Cohere rerank
        try:
            print("\n=== Cohere Rerank ===")
            result = await cohere_rerank(
                query=query,
                documents=docs,
                top_n=2,
            )
            print("Results:")
            for item in result:
                print(f"Index: {item['index']}, Score: {item['relevance_score']:.4f}")
                print(f"Document: {docs[item['index']]}")
        except Exception as e:
            print(f"Cohere Error: {e}")

        # Test Aliyun rerank
        try:
            print("\n=== Aliyun Rerank ===")
            result = await ali_rerank(
                query=query,
                documents=docs,
                top_n=2,
            )
            print("Results:")
            for item in result:
                print(f"Index: {item['index']}, Score: {item['relevance_score']:.4f}")
                print(f"Document: {docs[item['index']]}")
        except Exception as e:
            print(f"Aliyun Error: {e}")

    asyncio.run(main())
