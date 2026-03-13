export async function logsAPI(req: Request) {

  return new Response(
    JSON.stringify({
      status: "logs endpoint ready"
    }),
    {
      headers: { "content-type": "application/json" }
    }
  )

}
