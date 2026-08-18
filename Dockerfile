FROM node:24-alpine AS web-builder

WORKDIR /web
ARG NEXT_PUBLIC_API_BASE_URL=""
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web ./
RUN npm run build


FROM python:3.13-slim AS runtime

WORKDIR /app
ENV BOOKMATE_DATA_DIR=/data
ENV BOOKMATE_WEB_DIR=/app/web
ENV PYTHONUNBUFFERED=1

COPY services/api/pyproject.toml ./
COPY services/api/app ./app
RUN pip install --no-cache-dir .

COPY --from=web-builder /web/out ./web

VOLUME ["/data"]
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
