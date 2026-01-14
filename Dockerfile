FROM node:20-slim

# ---- System deps ---
RUN apt-get update && \
    apt-get install -y \
      qpdf \
      libcairo2 \
      libpango-1.0-0 \
      libjpeg62-turbo \
      libgif7 \
      librsvg2-2 \
    && rm -rf /var/lib/apt/lists/*

# ---- App ---
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3001

CMD ["node", "app.js"]
