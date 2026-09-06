p="docs/SYSTEM-ONTOLOGY.md"
lines=open(p,encoding="utf-8").read().split("\n")
def find(pref):
    r=[i for i,l in enumerate(lines) if l.startswith(pref)]
    assert len(r)==1,(pref,r); return r[0]
a=find("#### 三类扩展")
b=find("### 结构边的「改」与「启停」")
c=find("#### 结构边物化 · 谓词筛行")
d=find("### 产能占用链路")
assert a<b<c<d,(a,b,c,d)
pred   = lines[c:d]      # predicate h4 block (misplaced)
relgap = lines[b:c]      # relation-edit-gaps h3 block
# desired: [.. a..b) materialize-h4 ][ predicate-h4 ][ relgap-h3 ][ d.. capacity-h3 ]
out = lines[:b] + pred + relgap + lines[d:]
assert len(out)==len(lines), (len(out),len(lines))
open(p,"w",encoding="utf-8").write("\n".join(out))
print("moved predicate h4 (%d lines) above relation-edit-gaps h3 (%d lines)"%(len(pred),len(relgap)))
