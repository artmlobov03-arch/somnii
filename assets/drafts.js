const storage = name => { try { return globalThis[name]; } catch { return null; } };
// No network or cross-account keys. Permanent device storage requires explicit opt-in.
export function createDraftStore(userId, { session = storage('sessionStorage'), local = storage('localStorage') } = {}) {
  const key = `somnii:draft:v1:${userId}:new`, preference = `somnii:draft:persist:${userId}`;
  const get = (store, name) => { try { return store?.getItem(name) || null; } catch { return null; } };
  const put = (store, name, value) => { try { if (!store) return false; store.setItem(name,value); return true; } catch { return false; } };
  const remove = (store, name) => { try { store?.removeItem(name); } catch {} };
  let persistent = get(local,preference) === 'true';
  const clear = () => { remove(session,key); remove(local,key); };
  function read() {
    const values = [get(session,key), persistent ? get(local,key) : null].filter(Boolean).flatMap(raw => {
      try {
        const data=JSON.parse(raw);
        if(data.version!==1 || typeof data.content!=='string' || data.content.length>6000 || typeof data.title!=='string' || data.title.length>120 || typeof data.updatedAt!=='string' || !Number.isFinite(Date.parse(data.updatedAt))) return [];
        return [data];
      } catch {return [];}
    });
    return values.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0] || null;
  }
  function save(data) {
    if(!data.title?.trim()&&!data.content?.trim()){clear();return true;}
    const value=JSON.stringify({...data,version:1,title:String(data.title||'').slice(0,120),content:String(data.content||'').slice(0,6000),updatedAt:new Date().toISOString()});
    const saved=put(session,key,value);
    const permanent=persistent&&put(local,key,value);
    return Boolean(saved||permanent);
  }
  return {read,save,clear,get persistent(){return persistent;},
    setPersistent(value){
      const draft=read(); persistent=Boolean(value);
      if(persistent){if(!put(local,preference,'true')){persistent=false;return false;}}
      else{remove(local,preference);remove(local,key);}
      return draft?save(draft):true;
    },
    purge(){clear();remove(local,preference);persistent=false;},
  };
}
