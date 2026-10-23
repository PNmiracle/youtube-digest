/* Only the trusted extension worker accesses Chrome local storage. */
(() => {
  function sourceKey(sender) {
    const url = new URL(sender?.url || '');
    if (url.protocol !== 'https:' || url.hostname !== 'langchain-ai.github.io' ||
        !url.pathname.startsWith('/lca-lessons/') || !Number.isInteger(sender?.tab?.id)) {
      throw new Error('Highlights are only available on lesson pages.');
    }
    return `lessonHighlights:${url.origin}${url.pathname}`;
  }
  function createStore(storage, makeId = () => crypto.randomUUID()) {
    const queues = new Map();
    async function handle(message, sender) {
      const key = sourceKey(sender);
      if (!['getLessonHighlights','addLessonHighlight','removeLessonHighlight'].includes(message.action)) throw new Error('Unsupported highlight action.');
      const work = (queues.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
        const stored = await storage.get(key);
        let items = Array.isArray(stored[key]) ? stored[key] : [];
        if (message.action === 'addLessonHighlight') {
          const item = message.item;
          if (!item || typeof item.quote !== 'string' || !item.quote.trim() || item.quote.length > 20000 ||
              typeof item.prefix !== 'string' || item.prefix.length > 48 ||
              typeof item.suffix !== 'string' || item.suffix.length > 48 ||
              !['yellow','green','pink'].includes(item.color)) throw new Error('Invalid highlight.');
          if (!items.some(x => x.quote === item.quote && x.prefix === item.prefix && x.suffix === item.suffix)) {
            if (items.length >= 500) throw new Error('This lesson has 500 highlights. Remove an entry before adding more.');
            items = [...items,{quote:item.quote,prefix:item.prefix,suffix:item.suffix,color:item.color,id:makeId(),createdAt:Date.now()}];
            await storage.set({[key]:items});
          }
        } else if (message.action === 'removeLessonHighlight') {
          if (typeof message.id !== 'string') throw new Error('Invalid highlight ID.');
          items = items.filter(x => x.id !== message.id);
          await storage.set({[key]:items});
        }
        return {success:true,items};
      });
      queues.set(key,work);
      try { return await work; } finally { if (queues.get(key) === work) queues.delete(key); }
    }
    return {handle};
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {createStore,sourceKey};
  else globalThis.LessonHighlightStore = {createStore,sourceKey};
})();
