export function createConsumer(events, eventName) {
	const seen = [];
	const unsubscribe = events.on(eventName, (event) => {
		seen.push(event);
	});
	return {
		seen,
		summary() {
			return seen.map((event) => event.type);
		},
		dispose() {
			unsubscribe();
		},
	};
}
