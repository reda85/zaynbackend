FROM node:20-slim

# ---- System deps ---
RUN apt-get update && \
    apt-get install -y \
      qpdf \
      ghostscript \
      libc6 \
    && rm -rf /var/lib/apt/lists/*

# ---- App ---
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3001

CMD ["node", "--import", "tsx", "app.js"]


