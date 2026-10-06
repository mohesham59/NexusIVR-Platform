FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
    sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list 2>/dev/null || true; \
    apt-get update --fix-missing -o Acquire::Retries=5 && \
    apt-get install -y --no-install-recommends \
    curl \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy RAG engine source code
COPY . .

EXPOSE 8085

# On startup, run repository sync to populate vector database and start server
CMD ["sh", "-c", "python rag_sync.py && python server.py"]
