export function createUpstreamInflightTracker({ maxPerUser = 2, maxGlobal = 12 } = {}) {
  let global = 0;
  const byUser = new Map();

  const normalizeUser = (user) => String(user || "unknown");

  const countForUser = (user) => Number(byUser.get(normalizeUser(user)) || 0);
  const globalCount = () => global;

  const acquire = (user) => {
    const key = normalizeUser(user);
    const userCount = countForUser(key);
    if (global >= maxGlobal || userCount >= maxPerUser) {
      return {
        allowed: false,
        global,
        user: userCount,
        release: () => {},
      };
    }

    global += 1;
    byUser.set(key, userCount + 1);

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      global = Math.max(0, global - 1);
      const cur = countForUser(key);
      if (cur <= 1) byUser.delete(key);
      else byUser.set(key, cur - 1);
    };

    return {
      allowed: true,
      global,
      user: userCount + 1,
      release,
    };
  };

  return {
    acquire,
    countForUser,
    globalCount,
  };
}
