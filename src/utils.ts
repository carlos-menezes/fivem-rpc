/** Generates a unique call ID scoped to a procedure and channel. */
export const generateCallId = ({
	procedure,
	channel,
}: {
	procedure: string;
	channel: string;
}): string =>
	// FiveM has no Web Crypto support; use a manual UUID implementation
	`${channel}:${procedure}:${"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
		/[xy]/g,
		(c) => {
			const r = (Math.random() * 16) | 0;
			const v = c === "x" ? r : (r & 0x3) | 0x8;
			return v.toString(16);
		},
	)}`;
