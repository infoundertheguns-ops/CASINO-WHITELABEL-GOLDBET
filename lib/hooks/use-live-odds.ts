"use client";

import { useEffect, useRef, useCallback, useState } from "react";

interface OddsChange {
  market_type: string;
  outcome_name: string;
  odds: number;
  previous_odds: number | null;
}

export interface LiveOddsMessage {
  event_id: string;
  ts: number;
  type: "update" | "finished";
  changes: OddsChange[];
  scores?: { home: number; away: number };
  minute?: number;
  period?: string;
  home_team?: string;
  away_team?: string;
  sport?: string;
  league?: string;
  market_count?: number;
  outcome_count?: number;
}

interface CachedEvent {
  external_id: string;
  home_team: string;
  away_team: string;
  sport: string;
  league: string;
  minute?: number;
  period?: string;
  scores?: { home: number; away: number };
  half_score_home?: number[];
  half_score_away?: number[];
  markets: { type: string; outcomes: { name: string; odds: number }[] }[];
  updated_at: number;
}

interface UseLiveOddsOptions {
  eventIds?: string[];
  onOddsChange?: (msg: LiveOddsMessage) => void;
  onSnapshot?: (snapshot: Record<string, CachedEvent>) => void;
  onFinished?: (eventId: string) => void;
  enabled?: boolean;
}

const MAX_RECONNECT_DELAY = 30_000;
const INITIAL_RECONNECT_DELAY = 1_000;

export function useLiveOdds(options: UseLiveOddsOptions = {}) {
  const { eventIds, onOddsChange, onSnapshot, onFinished, enabled = true } = options;

  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const reconnectDelay = useRef(INITIAL_RECONNECT_DELAY);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable callback refs
  const onOddsChangeRef = useRef(onOddsChange);
  onOddsChangeRef.current = onOddsChange;
  const onSnapshotRef = useRef(onSnapshot);
  onSnapshotRef.current = onSnapshot;
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    let url = "/api/odds/stream";
    if (eventIds && eventIds.length > 0) {
      url += `?events=${eventIds.join(",")}`;
    }

    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener("snapshot", (e) => {
      try {
        const data = JSON.parse(e.data);
        onSnapshotRef.current?.(data);
      } catch {}
    });

    es.addEventListener("odds", (e) => {
      try {
        const msg: LiveOddsMessage = JSON.parse(e.data);
        if (msg.type === "finished") {
          onFinishedRef.current?.(msg.event_id);
        } else {
          onOddsChangeRef.current?.(msg);
        }
      } catch {}
    });

    es.addEventListener("heartbeat", () => {
      // Connection alive — reset reconnect delay
      reconnectDelay.current = INITIAL_RECONNECT_DELAY;
    });

    es.addEventListener("error", () => {
      // Error event includes connection failures
    });

    es.onopen = () => {
      setConnected(true);
      reconnectDelay.current = INITIAL_RECONNECT_DELAY;
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      esRef.current = null;

      // Exponential backoff reconnect
      reconnectTimer.current = setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, MAX_RECONNECT_DELAY);
        connect();
      }, reconnectDelay.current);
    };
  }, [eventIds?.join(",")]);

  useEffect(() => {
    if (!enabled) return;

    connect();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      setConnected(false);
    };
  }, [connect, enabled]);

  return { connected };
}
