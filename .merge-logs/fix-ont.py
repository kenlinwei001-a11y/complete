import io
p="docs/SYSTEM-ONTOLOGY.md"
lines=open(p,encoding="utf-8").read().split("\n")
# locate markers (0-based)
s=[i for i,l in enumerate(lines) if l.startswith("<<<<<<< ")]
m=[i for i,l in enumerate(lines) if l=="======="]
e=[i for i,l in enumerate(lines) if l.startswith(">>>>>>> ")]
assert len(s)==1 and len(e)==1, (s,m,e)
S,E=s[0],e[0]
M=[x for x in m if S<x<E]
assert len(M)==1, M
M=M[0]
head=lines[S+1:M]            # branch4: ### WO-RELATION-EDIT-GAPS
theirs=lines[M+1:E]          # branch6: #### WO-MATERIALIZE-3EXT
print("HEAD side first line :", head[0][:60])
print("THEIRS side first line:", theirs[0][:60])
# order: theirs (h4, subsection of the viaProperty h3 above) THEN head (new h3)
merged = theirs + [""] + head
out = lines[:S] + merged + lines[E+1:]
open(p,"w",encoding="utf-8").write("\n".join(out))
print("resolved. head_lines=%d theirs_lines=%d"%(len(head),len(theirs)))
