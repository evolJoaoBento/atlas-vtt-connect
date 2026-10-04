import type { Channel, ChannelPort, PeerLink } from './types';

/** One channel of `link` as a `ChannelPort`. */
export function channelPort(link: PeerLink, channel: Channel): ChannelPort {
  return {
    send: (data: string | ArrayBuffer): void => link.send(channel, data),
    bufferedAmount: (): number => link.bufferedAmount(channel),
    onDrain: (threshold: number, cb: () => void): (() => void) => link.onDrain(channel, threshold, cb),
    onClose: (cb: () => void): (() => void) => link.onClose(cb),
  };
}
