export function json(data: any, status = 200) {

  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json"
    }
  })

}
