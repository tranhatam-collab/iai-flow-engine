export async function runsAPI(request: Request) {

  return new Response(
    JSON.stringify({
      message: "Runs API placeholder"
    }),
    {
      headers: {
        "content-type": "application/json"
      }
    }
  )

}
