---
title: A post that forgot its tags
---

Here we share the housing guide, but the link has no UTM tags:

https://example.com/guides/how-jeonse-works

Every visit from this link will show up in analytics as "direct," as if it came
from nowhere. The lint check flags it.

This second link remembered its tags but hand-wrote the source with the wrong
casing, which splinters analytics just as badly:

https://example.com/guides/how-jeonse-works?utm_source=LinkedIn&utm_medium=social

The lint check flags that too, naming the offending value.
