package main

import (
	"flag"
	"fmt"
	"os"
	"strings"
	"sync"

	"github.com/GopeedLab/gopeed/pkg/base"
	"github.com/GopeedLab/gopeed/pkg/download"
	"github.com/GopeedLab/gopeed/pkg/protocol/http"
	"github.com/GopeedLab/gopeed/pkg/util"
)

const progressWidth = 20

func main() {
	connections := flag.Int("C", 16, "Concurrent connections")
	dir := flag.String("D", ".", "Store directory")
	flag.Parse()
	if flag.NArg() < 1 {
		fmt.Fprintln(os.Stderr, "usage: gopeed-dl [-C n] [-D dir] <url>")
		os.Exit(1)
	}
	rawURL := flag.Arg(0)

	headers := parseHeaders(os.Getenv("GOPEED_HEADERS"))
	cookie := strings.TrimSpace(os.Getenv("GOPEED_COOKIE"))
	if cookie != "" {
		if headers == nil {
			headers = make(map[string]string)
		}
		if _, ok := headers["Cookie"]; !ok {
			headers["Cookie"] = cookie
		}
	}

	boot := download.Boot().URL(rawURL)
	if len(headers) > 0 {
		boot = boot.Extra(&http.ReqExtra{Header: headers})
	}

	var wg sync.WaitGroup
	wg.Add(1)
	_, err := boot.
		Listener(func(event *download.Event) {
			if event.Key == download.EventKeyProgress {
				printProgress(event.Task, "downloading...")
			}
			if event.Key == download.EventKeyFinally {
				title := "complete"
				if event.Err != nil {
					title = "fail"
				}
				printProgress(event.Task, title)
				fmt.Println()
				if event.Err != nil {
					fmt.Printf("reason: %s\n", event.Err.Error())
					os.Exit(1)
				}
				fmt.Printf("saving path: %s\n", *dir)
				wg.Done()
			}
		}).
		Create(&base.Options{
			Path:  *dir,
			Extra: http.OptsExtra{Connections: *connections},
		})
	if err != nil {
		fmt.Fprintf(os.Stderr, "create task failed: %s\n", err)
		os.Exit(1)
	}
	printProgress(nil, "downloading...")
	wg.Wait()
}

func parseHeaders(raw string) map[string]string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	headers := make(map[string]string)
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		name, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		name = strings.TrimSpace(name)
		value = strings.TrimSpace(value)
		if name == "" || value == "" {
			continue
		}
		headers[name] = value
	}
	if len(headers) == 0 {
		return nil
	}
	return headers
}

var lastLineLen = 0

func printProgress(task *download.Task, title string) {
	var downloaded, total, speed int64
	if task != nil && task.Progress != nil {
		downloaded = task.Progress.Downloaded
		speed = task.Progress.Speed
	}
	if task != nil && task.Meta != nil && task.Meta.Res != nil {
		total = task.Meta.Res.Size
	}
	var rate float64
	if total > 0 {
		rate = float64(downloaded) / float64(total)
	}
	completeWidth := int(progressWidth * rate)
	var b strings.Builder
	fmt.Fprintf(&b, "\r%s [", title)
	for i := 0; i < progressWidth; i++ {
		if i < completeWidth {
			b.WriteString("■")
		} else {
			b.WriteString("□")
		}
	}
	fmt.Fprintf(&b, "] %.1f%%    %s/s    %s", rate*100, util.ByteFmt(speed), util.ByteFmt(total))
	line := b.String()
	if lastLineLen > len(line) {
		line += strings.Repeat(" ", lastLineLen-len(line))
	}
	lastLineLen = len(line)
	fmt.Print(line)
}
