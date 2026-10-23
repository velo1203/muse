import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ImagePlus, Loader2, Search, Wand2 } from "lucide-react";
import { api, formatTime, qualityLabel } from "../api";
import { useStore } from "../store";
import type { CatalogTrack, Track, YtResult } from "../types";
import { Cover } from "./Art";

function InfoTab({ track, onClose }: { track: Track; onClose: () => void }) {
  const { setLibrary, showToast } = useStore();
  const [f, setF] = useState({
    title: track.title,
    artist: track.artist,
    album: track.album,
    year: track.year ?? "",
    genre: track.genre ?? "",
    trackNumber: track.trackNumber?.toString() ?? "",
  });
  const [cover, setCover] = useState<string | null>(null);
  const [matches, setMatches] = useState<CatalogTrack[] | null>(null);
  const [busy, setBusy] = useState(false);
  const field = (k: keyof typeof f, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field">
      <span>{label}</span>
      <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} />
    </label>
  );

  const findInCatalog = async () => {
    setBusy(true);
    try {
      setMatches(await api.catalogSearch(`${f.artist} ${f.title}`));
    } catch (e) {
      showToast(String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickImage = async () => {
    const file = await open({ multiple: false, filters: [{ name: "이미지", extensions: ["jpg", "jpeg", "png", "webp"] }] });
    if (typeof file === "string") setCover(file);
  };

  const save = async () => {
    if (!f.title.trim() || !f.artist.trim()) return showToast("제목과 아티스트는 필수예요");
    try {
      let lib = await api.updateTrack(track.id, {
        title: f.title.trim(),
        artist: f.artist.trim(),
        album: f.album.trim(),
        year: f.year.trim() || null,
        genre: f.genre.trim() || null,
        trackNumber: f.trackNumber ? Number(f.trackNumber) || null : null,
      });
      if (cover) lib = await api.setTrackCover(track.id, cover);
      setLibrary(lib);
      showToast("정보를 저장했어요");
      onClose();
    } catch (e) {
      showToast(String(e));
    }
  };

  return (
    <>
      <div className="edit-grid">
        <div className="edit-cover" onClick={pickImage} title="이미지 파일 선택">
          {cover ? <img src={cover.startsWith("http") ? cover : undefined} alt="" /> : <Cover src={track.cover} className="cover-fill" size={40} />}
          {cover && !cover.startsWith("http") && <div className="cover-note">새 이미지 선택됨</div>}
          <div className="edit-cover-hover">
            <ImagePlus size={22} /> 사진 선택
          </div>
        </div>
        <div className="fields">
          {field("title", "제목", { autoFocus: true })}
          {field("artist", "아티스트")}
          {field("album", "앨범")}
          <div className="field-row">
            {field("year", "연도", { inputMode: "numeric", maxLength: 4 })}
            {field("trackNumber", "트랙 번호", { inputMode: "numeric" })}
            {field("genre", "장르")}
          </div>
        </div>
      </div>
      <button className="dl-btn" style={{ marginTop: 14 }} onClick={findInCatalog} disabled={busy}>
        {busy ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />} 음원 정보 자동 채우기
      </button>
      {matches && (
        <div className="match-list">
          {matches.length === 0 && <div className="s">일치하는 곡을 찾지 못했어요</div>}
          {matches.slice(0, 8).map((m, i) => (
            <button
              key={i}
              className="match"
              onClick={() => {
                setF({
                  title: m.title,
                  artist: m.artist,
                  album: m.album,
                  year: m.year ?? "",
                  genre: m.genre ?? "",
                  trackNumber: m.trackNumber?.toString() ?? "",
                });
                if (m.artwork) setCover(m.artwork);
                setMatches(null);
              }}
            >
              <img src={m.artwork} alt="" />
              <span className="ellipsis">
                <b>{m.title}</b> · {m.artist} — {m.album}
              </span>
              <span className="dim">{m.year}</span>
            </button>
          ))}
        </div>
      )}
      <div className="row" style={{ marginTop: 18 }}>
        <button className="pill-btn ghost" onClick={onClose}>
          취소
        </button>
        <button className="pill-btn" onClick={save}>
          저장하기
        </button>
      </div>
    </>
  );
}

function SourceTab({ track, onClose }: { track: Track; onClose: () => void }) {
  const { replaceSource } = useStore();
  const [query, setQuery] = useState(`${track.artist} ${track.title}`);
  const [results, setResults] = useState<YtResult[] | null>(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    setBusy(true);
    try {
      setResults(await api.youtubeSearch(query));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    search();
  }, []);

  const choose = (id?: string) => {
    replaceSource(track, id);
    onClose();
  };

  return (
    <>
      <div className="info-card">
        <div className="kv">
          현재 음원
          <b>
            {track.source === "local" ? "내 파일" : `YouTube · ${track.youtubeId}`} {qualityLabel(track) && `· ${qualityLabel(track)}`}
          </b>
        </div>
        <div className="s" style={{ marginTop: 6 }}>
          라이브 버전이나 다른 곡이 받아졌다면 아래에서 맞는 영상을 골라 바꿔주세요. 제목·좋아요·플레이리스트는 그대로 유지돼요.
        </div>
      </div>
      <form
        className="search-box"
        style={{ width: "100%", marginBottom: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <Search size={16} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} />
        {busy && <Loader2 size={16} className="spin" />}
      </form>
      <div className="source-list">
        {results?.map((r) => (
          <div key={r.id} className={`result-row yt ${r.id === track.youtubeId ? "current-src" : ""}`}>
            <div className="art">
              <img src={r.thumbnail} alt="" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="t">{r.title}</div>
              <div className="s">{r.channel}</div>
            </div>
            <div className="dur">{formatTime(r.duration)}</div>
            {r.id === track.youtubeId ? (
              <span className="dl-btn done">현재 음원</span>
            ) : (
              <button className="dl-btn" onClick={() => choose(r.id)}>
                이걸로 교체
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="pill-btn ghost" onClick={onClose}>
          닫기
        </button>
        <button className="pill-btn" onClick={() => choose()}>
          자동으로 다시 찾기
        </button>
      </div>
    </>
  );
}

export function EditTrackModal({ trackId, initialTab = "info", onClose }: { trackId: string; initialTab?: "info" | "source"; onClose: () => void }) {
  const track = useStore((s) => s.library.tracks.find((t) => t.id === trackId));
  const [tab, setTab] = useState(initialTab);
  if (!track) return null;
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="modal-tabs">
          <button className={`chip ${tab === "info" ? "on" : ""}`} onClick={() => setTab("info")}>
            정보
          </button>
          <button className={`chip ${tab === "source" ? "on" : ""}`} onClick={() => setTab("source")}>
            음원
          </button>
        </div>
        {tab === "info" ? <InfoTab track={track} onClose={onClose} /> : <SourceTab track={track} onClose={onClose} />}
      </div>
    </div>
  );
}
