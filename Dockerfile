# Build stage - compiles the application
FROM node:lts-alpine AS base

# Dependency Installation
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Development stage
# =============================================================================
# Create a development stage based on the "base" image
FROM base AS development

WORKDIR /app

COPY package*.json ./

RUN npm ci && npm cache clean --force

USER node
COPY --chown=node:node . .

CMD ["npm", "run", "dev"]

# Production stage
# =============================================================================
# Create a production stage based on the "base" image
FROM base AS production

WORKDIR /app

USER node
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .

EXPOSE 5000

CMD ["node", "server.js"]
