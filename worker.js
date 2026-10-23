const BASES = [
  "https://movies-api.accel.li/api/v2",
  "https://yts.lt/api/v2",
  "https://yts.gg/api/v2",
  "https://yts.bz/api/v2",
  "https://yts.rs/api/v2"
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*"
    }
  });
}

async function yts(path) {
  let lastError = "Catálogo temporariamente indisponível";
  for (const base of BASES) {
    try {
      const response = await fetch(base + path, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) { lastError = "Fonte respondeu HTTP " + response.status; continue; }
      const body = await response.json();
      if (body?.status === "ok" && body?.data) return body.data;
      lastError = "Resposta inesperada da fonte";
    } catch (error) {
      lastError = String(error?.message || error);
    }
  }
  throw new Error(lastError);
}

function normalize(movie) {
  return {
    id: "yts-" + (movie.id || movie.imdb_code || movie.title),
    imdb: movie.imdb_code || "",
    title: movie.title_english || movie.title || "",
    year: movie.year || "",
    rating: movie.rating || 0,
    runtime: movie.runtime || 0,
    genres: movie.genres || [],
    language: movie.language || "",
    summary: movie.summary || movie.description_full || movie.synopsis || "",
    poster: movie.large_cover_image || movie.medium_cover_image || movie.small_cover_image || "",
    background: movie.background_image_original || movie.background_image || "",
    torrents: (movie.torrents || []).map(t => ({
      hash: String(t.hash || "").toLowerCase(),
      quality: t.quality || "SD",
      codec: t.video_codec || "",
      type: t.type || "",
      seeds: Number(t.seeds) || 0,
      peers: Number(t.peers) || 0,
      size: t.size || "",
      sizeBytes: Number(t.size_bytes) || 0,
      audioChannels: t.audio_channels || "",
      source: "YTS"
    })).filter(t => /^[0-9a-f]{40}$/.test(t.hash)).sort((a,b) => b.seeds-a.seeds)
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return json({ ok: true, platform: "cloudflare-workers", catalog: true, torrentStreaming: false });
    }
    if (url.pathname === "/api/catalog") {
      try {
        const page = Math.max(1, Math.min(100, Number(url.searchParams.get("page") || 1)));
        const sort = url.searchParams.get("sort") || "year";
        const order = url.searchParams.get("order") === "asc" ? "asc" : "desc";
        const genre = (url.searchParams.get("genre") || "").slice(0, 40);
        const params = new URLSearchParams({ limit: "24", page: String(page), sort_by: sort, order_by: order });
        if (genre) params.set("genre", genre);
        const data = await yts("/list_movies.json?" + params.toString());
        return json({ page, movies: (data.movies || []).map(normalize), demo: false });
      } catch (error) {
        return json({ error: "Não foi possível carregar o catálogo agora.", detail: String(error?.message || error), movies: [] }, 502);
      }
    }
    if (url.pathname === "/api/search") {
      const q = (url.searchParams.get("q") || "").trim().slice(0, 120);
      if (!q) return json({ results: [], extra: [] });
      try {
        const params = new URLSearchParams({ query_term: q, limit: "20" });
        const data = await yts("/list_movies.json?" + params.toString());
        return json({ results: (data.movies || []).map(normalize), extra: [] });
      } catch (error) {
        return json({ error: "Busca indisponível no momento.", detail: String(error?.message || error), results: [], extra: [] }, 502);
      }
    }
    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Esta função ainda precisa de um servidor compatível com o Cinep2p completo.", route: url.pathname }, 501);
    }
    return env.ASSETS.fetch(request);
  }
};
