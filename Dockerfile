FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY public ./public
# Read-only frozen inputs for the optional public Paper runner.
COPY examples/hybrid-shadow.profile.json examples/hybrid-research.plan.json examples/pullback-reference.study.json ./examples/

USER node
CMD ["node", "dist/index.js"]
