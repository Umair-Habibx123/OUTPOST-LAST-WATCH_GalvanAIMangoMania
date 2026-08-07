// src/leaderboard.js

/* Leaderboard store.

   Ships with a localStorage provider so the game works offline / on itch.io
   with zero backend. The API (submit / top / clear) is deliberately small so
   an event host can swap in a shared remote provider (e.g. a tiny serverless
   endpoint or a service like Supabase) without touching game code — see
   OLW.Leaderboard.setProvider().

   For a single-kiosk event this local store is enough: everyone plays on the
   same machine, scores persist in that browser. For cross-device scoring,
   drop in a remote provider on event day. */
window.OLW = window.OLW || {};

OLW.Leaderboard = (function () {
  const MAX_ENTRIES = 50;

  async function parseResponse(response) {
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(
        body?.message || 'Leaderboard request failed.'
      );
    }

    return body;
  }

  return {
    async top(number, options) {
      const limit = Math.min(
        Math.max(Number(number) || 10, 1),
        MAX_ENTRIES
      );

      const query = new URLSearchParams({
        limit: String(limit)
      });

      if (options?.mode) {
        query.set('mode', options.mode);
      }

      if (options?.mapId) {
        query.set('map', options.mapId);
      }

      const response = await fetch(
        `/api/leaderboard?${query.toString()}`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json'
          }
        }
      );

      return parseResponse(response);
    },

    async submit(entry) {
      const payload = {
        displayName:
          String(entry.name || entry.displayName || 'Guard')
            .trim()
            .slice(0, 20) || 'Guard',

        mode: entry.mode || 'solo',
        mapId: entry.mapId || 'frontier',

        score: Math.max(
          0,
          Math.round(Number(entry.score) || 0)
        ),

        durationSeconds: Math.max(
          0,
          Number(entry.time || entry.durationSeconds) || 0
        ),

        wavesCleared: Math.max(
          0,
          Math.round(
            Number(entry.waves || entry.wavesCleared) || 0
          )
        ),

        kills: Math.max(
          0,
          Math.round(Number(entry.kills) || 0)
        ),

        perfectWaves: Math.max(
          0,
          Math.round(Number(entry.perfectWaves) || 0)
        ),

        deviceId: (window.OLW && OLW.Device && OLW.Device.id) || undefined
      };

      const response = await fetch('/api/leaderboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(payload)
      });

      return parseResponse(response);
    },

    async clear() {
      throw new Error(
        'Leaderboard reset is only available to event administrators.'
      );
    },

    async rankOf(score, options) {
      const entries = await this.top(MAX_ENTRIES, options);

      const numericScore = Math.max(
        0,
        Number(score) || 0
      );

      const position = entries.findIndex(
        (entry) => Number(entry.score) <= numericScore
      );

      return position === -1
        ? entries.length + 1
        : position + 1;
    }
  };
})();
