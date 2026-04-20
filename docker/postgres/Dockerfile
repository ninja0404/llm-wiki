FROM postgres:18-bookworm

ARG PG_MAJOR=18
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates lsb-release wget && \
    wget "https://packages.groonga.org/debian/groonga-apt-source-latest-$(lsb_release --codename --short).deb" && \
    apt-get install -y --no-install-recommends "./groonga-apt-source-latest-$(lsb_release --codename --short).deb" && \
    rm "groonga-apt-source-latest-$(lsb_release --codename --short).deb" && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      "postgresql-${PG_MAJOR}-pgvector" \
      "postgresql-${PG_MAJOR}-pgdg-pgroonga" && \
    rm -rf /var/lib/apt/lists/*
