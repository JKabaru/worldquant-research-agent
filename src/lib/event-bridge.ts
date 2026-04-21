// ============================================================
// Event Bridge - Server-side event emitter for SSE streaming
// Bridges research engine events to the frontend via Server-Sent Events
// ============================================================

type EventListener = (data: unknown) => void;

class EventBridge {
  private listeners: Map<string, Set<EventListener>> = new Map();

  on(event: string, listener: EventListener): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }

  off(event: string, listener: EventListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, data: unknown): void {
    this.listeners.get(event)?.forEach(listener => {
      try { listener(data); } catch { /* ignore listener errors */ }
    });
  }

  /**
   * Create a ReadableStream for SSE that subscribes to all event types.
   * Used by the /api/events route to push real-time updates to the client.
   */
  getEventStream(): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        const handler: EventListener = (data: unknown) => {
          try {
            const payload = typeof data === 'object' ? JSON.stringify(data) : String(data);
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          } catch {
            // Stream may be closed
          }
        };

        // Subscribe to all research event types
        const types = [
          'status', 'alpha_generated', 'simulation_submitted', 'simulation_complete',
          'alpha_accepted', 'alpha_rejected', 'error', 'generation_complete',
          'correction', 'diversity_check', 'style_rotation', 'critique_resubmit',
          'hypothesis_generated', 'mutation_spike',
        ];
        types.forEach(t => this.on(t, handler));

        // Send initial connection message
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`));

        // Return cleanup function (not standard but used by some implementations)
        return () => {
          types.forEach(t => this.off(t, handler));
          try { controller.close(); } catch { /* already closed */ }
        };
      },
    });
  }
}

// Singleton instance
export const eventBridge = new EventBridge();
