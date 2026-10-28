ARG RUST_IMAGE=rust:1-bookworm
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${RUST_IMAGE} AS zcash-devtool-build

ARG ZCASH_DEVTOOL_COMMIT=0b3436bb8d235c67cd36b800cb45a7b1b489c415
ENV CARGO_NET_GIT_FETCH_WITH_CLI=true

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/zcash/zcash-devtool.git /src/zcash-devtool \
    && git -C /src/zcash-devtool checkout --detach "${ZCASH_DEVTOOL_COMMIT}" \
    && cargo build --locked --release --manifest-path /src/zcash-devtool/Cargo.toml

FROM ${NODE_IMAGE} AS app-build

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npx -y pnpm@10.33.4 install --frozen-lockfile

COPY . .
RUN npx -y pnpm@10.33.4 build \
    && npx -y pnpm@10.33.4 prune --prod

FROM ${NODE_IMAGE} AS runtime

ENV ZECAID_DEVTOOL_BIN=/usr/local/bin/zcash-devtool \
    NODE_ENV=production

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=zcash-devtool-build /src/zcash-devtool/target/release/zcash-devtool /usr/local/bin/zcash-devtool
COPY --from=app-build /app/ ./

RUN mkdir -p /app/data

EXPOSE 43124

CMD ["sh", "-c", "./node_modules/.bin/next start -H 0.0.0.0 -p ${PORT:-43124}"]
