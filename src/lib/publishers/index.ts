import { blueskyPublisher } from "./bluesky";
import { linkedinPublisher } from "./linkedin";
import { mastodonPublisher } from "./mastodon";
import { threadsPublisher } from "./threads";

export const publishers = {
  bluesky: blueskyPublisher,
  mastodon: mastodonPublisher,
  linkedin: linkedinPublisher,
  threads: threadsPublisher,
};
