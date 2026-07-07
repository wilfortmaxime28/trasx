class Peer {
  constructor(peerId, socketId) {
    this.id = peerId;
    this.socketId = socketId;
    this.transports = new Map(); // transportId -> Transport
    this.producers = new Map();  // producerId -> Producer
    this.consumers = new Map();  // consumerId -> Consumer
  }

  addTransport(transport) {
    this.transports.set(transport.id, transport);
  }

  getTransport(transportId) {
    return this.transports.get(transportId);
  }

  closeTransport(transportId) {
    const transport = this.transports.get(transportId);
    if (transport) {
      transport.close();
      this.transports.delete(transportId);
    }
  }

  addProducer(producer) {
    this.producers.set(producer.id, producer);
  }

  closeProducer(producerId) {
    const producer = this.producers.get(producerId);
    if (producer) {
      producer.close();
      this.producers.delete(producerId);
    }
  }

  addConsumer(consumer) {
    this.consumers.set(consumer.id, consumer);
  }

  closeConsumer(consumerId) {
    const consumer = this.consumers.get(consumerId);
    if (consumer) {
      consumer.close();
      this.consumers.delete(consumerId);
    }
  }

  close() {
    this.producers.forEach(p => p.close());
    this.producers.clear();

    this.consumers.forEach(c => c.close());
    this.consumers.clear();

    this.transports.forEach(t => t.close());
    this.transports.clear();
  }
}

module.exports = Peer;
