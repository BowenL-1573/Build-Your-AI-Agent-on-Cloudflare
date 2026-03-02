FROM docker.io/cloudflare/sandbox:0.7.0-python
RUN pip3 install --no-cache-dir playwright httpx html2text
RUN python3 -m playwright install --with-deps chromium
COPY scripts/ /workspace/
