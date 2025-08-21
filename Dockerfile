# Build stage - compiles the application
FROM node:lts-alpine AS base

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

COPY package*.json .

RUN npm ci --omit=dev && npm cache clean --force

USER node
COPY --chown=node:node . .

EXPOSE 5000

CMD ["npm", "start"]
