export async function logsAPI(request: Request) {

  return new Response(
    JSON.stringify({
      message: "Logs API placeholder"
    }),
    {
      headers: {
        "content-type": "application/json"
      }
    }
  )

}
