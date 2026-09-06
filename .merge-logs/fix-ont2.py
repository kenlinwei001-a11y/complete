import sys
def resolve_keep_both(p, order="head_first"):
    lines=open(p,encoding="utf-8").read().split("\n")
    s=[i for i,l in enumerate(lines) if l.startswith("<<<<<<< ")]
    e=[i for i,l in enumerate(lines) if l.startswith(">>>>>>> ")]
    assert len(s)==1 and len(e)==1,(p,s,e)
    S,E=s[0],e[0]
    M=[x for x in range(S,E) if lines[x]=="======="]
    assert len(M)==1,(p,M)
    M=M[0]
    head=lines[S+1:M]; theirs=lines[M+1:E]
    print("%s\n  HEAD  : %s\n  THEIRS: %s"%(p,head[0][:60],theirs[0][:60]))
    merged = (head+[""]+theirs) if order=="head_first" else (theirs+[""]+head)
    open(p,"w",encoding="utf-8").write("\n".join(lines[:S]+merged+lines[E+1:]))
    print("  -> kept both (%s), head=%d theirs=%d"%(order,len(head),len(theirs)))
resolve_keep_both("docs/SYSTEM-ONTOLOGY.md")
