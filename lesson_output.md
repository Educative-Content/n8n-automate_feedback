# undefined
This lesson brings you a challenge to solve.
---

## Problem statement
Define a struct `employee` with a field `salary` and make a method `giveRaise()` for this type to increase the salary with a certain percentage.

>__Note:__ `employee` is the struct type, and `salary` is its field. Do not change the name of these variables.



Try to implement the function below. Feel free to view the solution, after giving some shots. Good Luck! 

**Decide Employee Salary**

```go
package main
import "fmt"
import "encoding/json"

/* basic data structure upon which we'll define methods */  
type employee struct {  
     salary float32
}  
  
/* a method which will add a specified percent to an 
   employees salary */  
func (this *employee) giveRaise(pct float32) {  
     
     return
}
```
<details>
<summary> Solution</summary>

```go
/* basic data structure upon which we'll define methods */  
type employee struct {  
     salary float32  
}  
  
/* a method which will add a specified percent to an 
   employees salary */  
func (this *employee) giveRaise(pct float32) {  
     this.salary += this.salary * pct  
}
```
</details>

---
We hope that you were able to solve the challenge. The next lesson brings you the solution to this challenge.
