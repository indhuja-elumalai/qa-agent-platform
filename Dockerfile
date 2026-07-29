FROM mcr.microsoft.com/playwright:v1.62.0-noble AS build
WORKDIR /app
ENV COREPACK_HOME=/tmp/corepack
ARG NEXT_PUBLIC_DEFAULT_TARGET_URL=http://demo-target:3100
ENV NEXT_PUBLIC_DEFAULT_TARGET_URL=${NEXT_PUBLIC_DEFAULT_TARGET_URL}
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/demo-target/package.json apps/demo-target/package.json
COPY packages ./packages
RUN corepack enable && corepack pnpm install --frozen-lockfile
COPY . .
RUN corepack pnpm build

FROM mcr.microsoft.com/playwright:v1.62.0-noble AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    COREPACK_HOME=/tmp/corepack \
    QA_DATA_DIR=/app/var \
    QA_DATABASE_PATH=/app/var/qa-platform.db
COPY --from=build --chown=pwuser:pwuser /app /app
RUN mkdir -p /app/var/evidence /app/var/reports /app/var/runs && chown -R pwuser:pwuser /app/var
USER pwuser
EXPOSE 3000 3100
CMD ["bash", "-lc", "corepack pnpm --filter @qa/web start"]
