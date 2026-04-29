#!/bin/sh

git archive --format tar HEAD | gzip | \
  ssh root@hosting.fenster.name 'cd /root/staging/rodinamsftbot && rm -rf deploy && mkdir deploy && tar -C deploy -xz && sh deploy.sh'
