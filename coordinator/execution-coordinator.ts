export class ExecutionCoordinator {

  state: DurableObjectState

  constructor(state: DurableObjectState) {
    this.state = state
  }

  async fetch(request: Request) {

    return new Response(
      JSON.stringify({
        coordinator: "active"
      }),
      {
        headers: {
          "content-type": "application/json"
        }
      }
    )

  }

}
