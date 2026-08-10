export default {
  fetch(): Response {
    return new Response("FlareLobby の基盤を初期化中です。", {
      status: 501,
      headers: {
        "content-type": "text/plain; charset=utf-8"
      }
    });
  }
} satisfies ExportedHandler<Env>;
