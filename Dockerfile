# Use official Node.js base
FROM node:18-slim

# Install minimal dependencies for puppeteer + Chromium
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
 && rm -rf /var/lib/apt/lists/*

# Create working directory
WORKDIR /app

# Copy files and install dependencies
COPY package*.json ./
RUN npm install

# Copy rest of your scraper code
COPY . .

# Optional: set env for puppeteer to skip download if already installed
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Pre-install Chromium
RUN node node_modules/puppeteer/install.js

# Default entrypoint
CMD ["node", "parser.mjs"]
