export async function runsAPI(req: Request) {

  return new Response(
    JSON.stringify({
      status: "runs endpoint ready"
    }),
    {
      headers: { "content-type": "application/json" }
    }
  )

}
