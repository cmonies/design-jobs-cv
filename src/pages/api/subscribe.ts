export const prerender = false;

import type { APIRoute } from 'astro';

const LISTMONK_URL = import.meta.env.LISTMONK_URL || 'https://listmonk-production-7c2c.up.railway.app';
const LISTMONK_USER = import.meta.env.LISTMONK_USER || 'admin';
const LISTMONK_PASS = import.meta.env.LISTMONK_PASS || '';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json() as { email?: string };
    const email = body.email?.trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ ok: false, error: 'Please enter a valid email address.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!LISTMONK_PASS) {
      return new Response(JSON.stringify({ ok: false, error: 'Newsletter not configured yet.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const auth = btoa(`${LISTMONK_USER}:${LISTMONK_PASS}`);

    // Create subscriber via admin API
    const res = await fetch(`${LISTMONK_URL}/api/subscribers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
      },
      body: JSON.stringify({
        email,
        name: '',
        status: 'enabled',
        lists: [1],
        preconfirm_subscriptions: true,
      }),
    });

    const data = await res.json() as { data?: { id: number }; message?: string };

    if (res.ok) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 409 = already subscribed — still a success from user's perspective
    if (res.status === 409) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.error('Listmonk error:', res.status, data.message);
    return new Response(JSON.stringify({ ok: false, error: 'Could not subscribe. Please try again.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Subscribe error:', err);
    return new Response(JSON.stringify({ ok: false, error: 'An unexpected error occurred.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
